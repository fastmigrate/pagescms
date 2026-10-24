import type { Field } from "@/types/field";

export const mediaFields: Field[] = [
  { name: "src", label: "File", type: "image", required: true },
  { name: "alt", label: "Image description", type: "string" },
  {
    name: "role", type: "select", required: true, hidden: true, default: "content",
    options: { values: ["content", "decorative"] },
  },
  {
    name: "presentation", type: "select", required: true, hidden: true, default: "cover",
    options: { values: ["cover", "contain"] },
  },
  {
    name: "focalPoint", type: "object", hidden: true,
    fields: [{ name: "x", type: "number" }, { name: "y", type: "number" }],
  },
];

export const optionalMedia: Field = {
  name: "media", label: "Optional media", type: "object", fields: mediaFields,
};

export const optionalObjectFixtures = {
  services: {
    fields: [
      { name: "title", label: "Title", type: "string", required: true },
      { ...optionalMedia, required: true, hidden: true },
      {
        name: "items", label: "Items", type: "object",
        list: { collapsible: { collapsed: true, summary: "{title}" } },
        fields: [
          { name: "title", label: "Item title", type: "string" },
          { name: "body", label: "Body", type: "text", required: true },
          optionalMedia,
        ],
      },
    ] as Field[],
    content: {
      title: "Services",
      media: { src: "/media/service.svg", role: "decorative", presentation: "contain" },
      items: Array.from({ length: 4 }, (_, index) => ({
        title: `Service ${index + 1}`, body: `Saved service description ${index + 1}.`,
      })),
    } as Record<string, any>,
  },
  contact: {
    fields: [
      { name: "title", label: "Title", type: "string", required: true },
      {
        name: "hero", label: "Introduction", type: "object",
        fields: [{ name: "summary", label: "Summary", type: "text" }, { ...optionalMedia, hidden: true }],
      },
      {
        name: "listing", type: "object", hidden: true,
        fields: [{ name: "summary", type: "text" }, optionalMedia],
      },
    ] as Field[],
    content: {
      title: "Contact",
      hero: { summary: "Saved introduction." },
      listing: { summary: "Saved listing description." },
    } as Record<string, any>,
  },
};
