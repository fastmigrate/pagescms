import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { productionLoader } from "./helpers/cms-git-fixture.mts";

const load = productionLoader();
const { assertMediaReferenceSafety } = load("lib/media-references.ts");
const { normalizeConfig } = load("lib/config.ts");
const { deepMap } = load("lib/schema.ts");
const { swapPrefix } = load("lib/github-image.ts");
const file = { name: "pdf", type: "file" };
const media = [{ name: "assets", input: "public/media", output: "/media" }];
const singleton = (fields = [file], extra = {}) => ({ name: "settings", type: "file", path: "content/settings.json", fields, ...extra });
const collection = (fields = [file], extra = {}) => ({ name: "posts", type: "collection", path: "content/posts", filename: "{primary}.json", fields, ...extra });
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const put = (path: string, value: unknown) => ({ action: "put", path, content: json(value) });
const remove = (path = "public/media/catalogue.pdf") => ({ action: "remove", path });

const fixture = (content: any[], documents: Record<string, unknown>, extra: Record<string, any> = {}) => {
  const blobs = new Map<string, Buffer>();
  const entries = new Map<string, any>();
  for (const [path, value] of Object.entries(documents)) {
    const bytes = Buffer.isBuffer(value) ? value : json(value);
    const sha = createHash("sha1").update(bytes).digest("hex");
    blobs.set(sha, bytes);
    entries.set(path, { path, sha, type: "blob", mode: "100644", size: bytes.length });
  }
  const reads: string[] = [];
  const configObject = normalizeConfig({ media, content, ...extra });
  const check = (changes: any[], readBlob = async (sha: string) => {
    reads.push(sha);
    const blob = blobs.get(sha);
    if (!blob) throw new Error("Fixture blob is missing.");
    return blob;
  }) => assertMediaReferenceSafety({ configObject, entries, changes, readBlob });
  return { configObject, entries, reads, check };
};

test("saved typed paths protect deletion and rename with indexed diagnostics", async () => {
  const fields = [
    { name: "title", type: "string" },
    { name: "hero", type: "object", fields: [{ name: "files", type: "file", options: { multiple: true }, hidden: true }] },
    { name: "photos", type: "image", list: true },
    { name: "cards", type: "object", list: true, fields: [file] },
    { name: "sections", type: "block", list: true, blockKey: "kind", blocks: [{ name: "download", type: "object", fields: [file] }] },
  ];
  const f = fixture([singleton(fields)], {
    "content/settings.json": { title: "/media/not-typed.pdf", hero: { files: ["/media/catalogue.pdf", "/media/catalogue.pdf?download=1#page=2"] }, photos: ["/media/catalogue.pdf"], cards: [{ pdf: "/media/catalogue.pdf" }], sections: [{ kind: "download", pdf: "/media/catalogue.pdf" }] },
    "public/media/catalogue.pdf": Buffer.from("pdf"),
  });
  for (const changes of [[remove()], [remove(), { action: "copy", path: "public/media/renamed.pdf", sha: f.entries.get("public/media/catalogue.pdf").sha }]]) {
    await assert.rejects(f.check(changes), (error: any) => {
      assert.equal(error.status, 409);
      assert.match(error.message, /5 saved references/u);
      for (const path of ["hero.files[1]", "photos[0]", "cards[0].pdf", "sections[0].pdf"]) assert.ok(error.message.includes(path));
      assert.match(error.message, /content "settings".*entry "content\/settings.json"/u);
      return true;
    });
  }
});

test("root lists and normalized groups/components retain saved draft uses", async () => {
  const f = fixture([{ type: "group", name: "hidden", hidden: true, items: [singleton([{ name: "download", component: "asset" }], { list: true, hidden: true })] }], {
    "content/settings.json": [{ download: "/media/catalogue.pdf", draft: true }],
    "public/media/catalogue.pdf": Buffer.from("pdf"),
  }, { components: { asset: { component: "base" }, base: { type: "file" } } });
  await assert.rejects(f.check([remove()]), /field "\[0\]\.download"/u);
});

test("unused cleanup tolerates an unrelated old missing reference", async () => {
  const f = fixture([singleton()], {
    "content/settings.json": { pdf: "/media/missing.pdf" },
    "public/media/catalogue.pdf": Buffer.from("pdf"),
  });
  await f.check([remove()]);
  await assert.rejects(f.check([put("content/settings.json", { pdf: "/media/missing.pdf", title: "edited" })]), /missing\.pdf.*does not exist/u);
});

test("prospective replacement, document removal and renamed documents use final membership", async () => {
  const f = fixture([collection()], {
    "content/posts/a.json": { pdf: "/media/catalogue.pdf" },
    "public/media/catalogue.pdf": Buffer.from("old"),
    "public/media/new.pdf": Buffer.from("new"),
  });
  await f.check([remove(), put("content/posts/a.json", { pdf: "/media/new.pdf" })]);
  await f.check([remove(), remove("content/posts/a.json")]);
  await f.check([remove(), { action: "put", path: "public/media/catalogue.pdf", content: Buffer.from("replacement") }]);
  const copy = { action: "copy", path: "content/posts/renamed.json", sha: f.entries.get("content/posts/a.json").sha };
  await assert.rejects(f.check([remove(), remove("content/posts/a.json"), copy]), /renamed\.json/u);
  await f.check([remove(), remove("content/posts/a.json"), { ...copy, path: "archive/renamed.json" }]);
});

test("a media alias write and a copied configured document validate final target existence", async () => {
  const f = fixture([singleton([file], { path: "public/media/upload.json" })], {
    "archive/source.json": { pdf: "/media/missing.pdf" },
  });
  await assert.rejects(f.check([put("public/media/upload.json", { pdf: "/media/missing.pdf" })]), /field "pdf".*missing\.pdf/u);
  await assert.rejects(f.check([{ action: "copy", path: "public/media/upload.json", sha: f.entries.get("archive/source.json").sha }]), /missing\.pdf/u);
  await f.check([put("public/media/upload.json", { pdf: "/media/new.pdf" }), { action: "put", path: "public/media/new.pdf", content: Buffer.from("pdf") }]);
});

test("collection membership respects exact roots, extensions, excluded traversal and subfolders", async () => {
  for (const path of ["content/posts-other/a.json", "content/posts/a.txt", "content/posts/ignored.json", "content/posts/private/a.json", "content/posts/sub/a.json"]) {
    const f = fixture([collection([file], { exclude: ["ignored.json", "private"], subfolders: false })], {
      [path]: Buffer.from("malformed content must remain outside membership"),
      "public/media/catalogue.pdf": Buffer.from("pdf"),
    });
    await f.check([remove()]);
    assert.equal(f.reads.length, 0);
  }
  const f = fixture([collection([file], { path: "", exclude: ["public"] })], {
    "draft.json": { pdf: "/media/catalogue.pdf", draft: true }, "public/media/catalogue.pdf": Buffer.from("pdf"),
  });
  await assert.rejects(f.check([remove()]), /draft\.json/u);
});

test("untyped content and non-reference text do not force a read or protect an asset", async () => {
  const f = fixture([singleton([{ name: "body", type: "rich-text" }, { name: "text", type: "string" }])], {
    "content/settings.json": Buffer.from("invalid JSON"), "public/media/catalogue.pdf": Buffer.from("pdf"),
  });
  await f.check([remove()]);
  assert.equal(f.reads.length, 0);
});

test("malformed relevant structures fail with content, entry and field context", async () => {
  const fields = [
    { name: "hero", type: "object", fields: [file] },
    { name: "cards", type: "object", list: true, fields: [file] },
    { name: "sections", type: "block", list: true, blocks: [{ name: "download", type: "object", fields: [file] }] },
    file,
  ];
  for (const [value, field] of [[{ hero: "bad" }, "hero"], [{ cards: { pdf: "/media/catalogue.pdf" } }, "cards"], [{ cards: [null] }, "cards[0]"], [{ sections: [{ _block: "unknown", pdf: "/media/catalogue.pdf" }] }, "sections[0]"], [{ pdf: 42 }, "pdf"], [{ pdf: ["/media/catalogue.pdf"] }, "pdf"]] as const) {
    const f = fixture([singleton(fields)], { "content/settings.json": value, "public/media/catalogue.pdf": Buffer.from("pdf") });
    await assert.rejects(f.check([remove()]), (error: any) => {
      assert.equal(error.status, 400);
      assert.ok(error.message.includes(`field "${field}"`));
      assert.match(error.message, /content "settings".*entry "content\/settings.json"/u);
      return true;
    });
  }
  const f = fixture([singleton(fields)], { "content/settings.json": { hero: null, cards: null, sections: null, unrelated: { pdf: "/media/catalogue.pdf" } }, "public/media/catalogue.pdf": Buffer.from("pdf") });
  await f.check([remove()]);
});

test("malformed containers without typed descendants preserve permissive production defaults", async () => {
  const fields = [{ name: "broken", type: "object", list: true, fields: [{ name: "title", type: "string" }] }, file];
  const f = fixture([singleton(fields)], { "content/settings.json": { broken: "old invalid value" }, "public/media/catalogue.pdf": Buffer.from("pdf") });
  await f.check([remove()]);
  assert.deepEqual(deepMap({ broken: "old invalid value" }, fields, (value: any) => value), { broken: [], pdf: undefined });
});

test("production read transforms resolve named/default media, encodings, suffixes and preserve case", async () => {
  for (const value of ["/media/My%20Catalogue.pdf?download=1#page=2", "public/media/My Catalogue.pdf"]) {
    const f = fixture([singleton()], { "content/settings.json": { pdf: value }, "public/media/My Catalogue.pdf": Buffer.from("pdf") });
    await assert.rejects(f.check([remove("public/media/My Catalogue.pdf")]), /My Catalogue\.pdf/u);
    await f.check([put("content/settings.json", { pdf: value })]);
    await assert.rejects(f.check([put("content/settings.json", { pdf: "/media/my%20catalogue.pdf" })]), /my catalogue\.pdf/u);
  }
  const f = fixture([singleton([{ ...file, options: { media: "docs" } }])], { "content/settings.json": { pdf: "/downloads/catalogue.pdf" }, "files/catalogue.pdf": Buffer.from("pdf") }, { media: [...media, { name: "docs", input: "files", output: "/downloads" }] });
  await assert.rejects(f.check([remove("files/catalogue.pdf")]), /files\/catalogue\.pdf/u);
});

test("root media output and root media input resolve without a prefix collision", async () => {
  for (const source of [{ name: "root", input: "public", output: "/" }, { name: "root", input: "", output: "/" }]) {
    const path = source.input ? `${source.input}/catalogue.pdf` : "catalogue.pdf";
    const f = fixture([singleton()], { "content/settings.json": { pdf: "/catalogue.pdf" }, [path]: Buffer.from("pdf") }, { media: [source] });
    await assert.rejects(f.check([remove(path)]), /catalogue\.pdf/u);
  }
});

test("external URLs and disabled web-root values remain outside repository coverage", async () => {
  for (const pdf of ["https://example.test/catalogue.pdf", "//example.test/catalogue.pdf", "data:application/pdf;base64,AAAA"]) {
    const f = fixture([singleton()], {}, {});
    await f.check([put("content/settings.json", { pdf })]);
  }
  const f = fixture([singleton([{ ...file, options: { media: false } }])], {});
  await f.check([put("content/settings.json", { pdf: "/website/catalogue.pdf" })]);
  await assert.rejects(f.check([put("content/settings.json", { pdf: "files/catalogue.pdf" })]), /files\/catalogue\.pdf/u);
});

test("prefix collisions, escapes and ambiguous source mappings never prove an asset unused", async () => {
  assert.equal(swapPrefix("/media-old/catalogue.pdf", "/media", "public/media", true), "/media-old/catalogue.pdf");
  assert.equal(swapPrefix("/media/catalogue.pdf", "/media", "public/media", true), "public/media/catalogue.pdf");
  for (const pdf of ["/media-old/catalogue.pdf", "/media/%2e%2e/%2e%2e/private.pdf", "../public/media/catalogue.pdf", "public\\media\\catalogue.pdf"]) {
    const f = fixture([singleton()], { "content/settings.json": { pdf }, "public/media/catalogue.pdf": Buffer.from("pdf") });
    await assert.rejects(f.check([remove()]), /Cannot verify media references/u);
  }
  const f = fixture([singleton()], { "content/settings.json": { pdf: "assets/public/catalogue.pdf" }, "assets/catalogue.pdf": Buffer.from("pdf") }, { media: [{ name: "ambiguous", input: "assets", output: "assets/public" }] });
  await assert.rejects(f.check([remove("assets/catalogue.pdf")]), /matches both input and output/u);
});

test("unsupported formats, parse/read failures and oversized relevant documents fail closed", async () => {
  for (const [schema, bytes] of [[{ format: "raw" }, Buffer.from("raw")], [{}, Buffer.from("not json")], [{ format: "yaml-frontmatter", extension: "json" }, Buffer.from("---\npdf: /media/catalogue.pdf\n")], [{}, Buffer.alloc(2 * 1024 * 1024 + 1, " ")]]) {
    const f = fixture([singleton([file], schema)], { "content/settings.json": bytes, "public/media/catalogue.pdf": Buffer.from("pdf") });
    await assert.rejects(f.check([remove()]), /Cannot verify media references/u);
  }
  const f = fixture([singleton()], { "content/settings.json": {}, "public/media/catalogue.pdf": Buffer.from("pdf") });
  await assert.rejects(f.check([remove()], async () => { throw new Error("GitHub unavailable"); }), /could not be read/u);
});

test("YAML, TOML and custom-delimiter frontmatter use the production serializer", async () => {
  for (const [format, text, delimiters] of [["yaml", "pdf: /media/catalogue.pdf\n"], ["toml", 'pdf = "/media/catalogue.pdf"\n'], ["yaml-frontmatter", "@@\npdf: /media/catalogue.pdf\n@@\nBody", "@@"], ["toml-frontmatter", '+++\npdf = "/media/catalogue.pdf"\n+++\nBody'], ["json-frontmatter", '{"pdf":"/media/catalogue.pdf"}\nBody']]) {
    const f = fixture([singleton([file], { format, delimiters })], { "content/settings.json": Buffer.from(text!), "public/media/catalogue.pdf": Buffer.from("pdf") });
    await assert.rejects(f.check([remove()]), /field "pdf"/u);
  }
});

test("bounded diagnostics keep the full saved-use count", async () => {
  const f = fixture([singleton([{ ...file, options: { multiple: true } }])], { "content/settings.json": { pdf: Array(12).fill("/media/catalogue.pdf") }, "public/media/catalogue.pdf": Buffer.from("pdf") });
  await assert.rejects(f.check([remove()]), (error: any) => {
    assert.match(error.message, /12 saved references/u);
    assert.match(error.message, /Showing 8 of 12/u);
    assert.ok(error.message.includes('pdf[7]'));
    assert.ok(!error.message.includes('pdf[8]'));
    return true;
  });
});

test("document reads are bounded and unsupported Git objects are never targets", async () => {
  const documents = Object.fromEntries(Array.from({ length: 10 }, (_, n) => [`content/posts/${n}.json`, {}]));
  const f = fixture([collection()], { ...documents, "public/media/catalogue.pdf": Buffer.from("pdf") });
  let active = 0;
  let maximum = 0;
  await f.check([remove()], async () => {
    maximum = Math.max(maximum, ++active);
    await new Promise(setImmediate);
    active--;
    return json({});
  });
  assert.ok(maximum <= 4);
  f.entries.set("public/media/link.pdf", { path: "public/media/link.pdf", type: "blob", mode: "120000", sha: "link" });
  await assert.rejects(f.check([put("content/posts/a.json", { pdf: "/media/link.pdf" })]), /does not exist in the final tree/u);
});

test("encoded literal query/hash filenames fail explicitly rather than appear unused", async () => {
  for (const encoded of ["a%23b.pdf", "a%3Fb.pdf", "a%2523b.pdf"]) {
    const path = encoded.includes("3F") ? "public/media/a?b.pdf" : "public/media/a#b.pdf";
    const f = fixture([singleton()], { "content/settings.json": { pdf: `/media/${encoded}` }, [path]: Buffer.from("pdf") });
    await assert.rejects(f.check([{ action: "remove", path }]), /field "pdf"/);
  }
});

test("a nonregular singleton prevents a complete relevant scan", async () => {
  const f = fixture([singleton()], { "public/media/catalogue.pdf": Buffer.from("pdf") });
  f.entries.set("content/settings.json", { path: "content/settings.json", type: "tree", mode: "040000", sha: "directory-sha" });
  await assert.rejects(f.check([remove()]), /not a regular Git blob/);
});

test("relative repository paths remain covered without a media source or with media disabled", async () => {
  for (const disabled of [false, true]) {
    const f = fixture([singleton([{ ...file, ...(disabled ? { options: { media: false } } : {}) }])], {
      "content/settings.json": { pdf: "public/media/catalogue.pdf" }, "public/media/catalogue.pdf": Buffer.from("pdf"),
    }, { media: disabled ? media : false });
    await assert.rejects(f.check([remove()]), /saved reference/);
    await assert.rejects(f.check([put("content/settings.json", { pdf: "public/media/missing.pdf" })]), /missing files/);
  }
});

test("unclosed YAML and compact JSON frontmatter fail rather than become a reference-free body", async () => {
  for (const [format, text] of [["yaml-frontmatter", "---\npdf: /media/catalogue.pdf\n"], ["json-frontmatter", '{"pdf":"/media/catalogue.pdf"\n']] as const) {
    const f = fixture([singleton([file], { format })], { "content/settings.json": Buffer.from(text), "public/media/catalogue.pdf": Buffer.from("pdf") });
    await assert.rejects(f.check([remove()]), /Malformed frontmatter/);
  }
});

test("invalid UTF-8 and malformed root-list documents fail with entry context", async () => {
  for (const value of [Buffer.from([0xff]), { pdf: "/media/catalogue.pdf" }, null]) {
    const f = fixture([singleton([file], { list: true })], { "content/settings.json": Buffer.isBuffer(value) ? value : json(value), "public/media/catalogue.pdf": Buffer.from("pdf") });
    await assert.rejects(f.check([remove()]), /content\/settings.json/);
  }
});

test("the reserved metadata document cannot overlap configured typed content", async () => {
  const f = fixture([singleton()], { "content/settings.json": { pdf: "/media/catalogue.pdf" }, "public/media/catalogue.pdf": Buffer.from("pdf") }, { mediaMetadata: "content/settings.json" });
  await assert.rejects(f.check([put("content/settings.json", { pdf: "/media/catalogue.pdf" })]), /reserved media metadata document/);
});
