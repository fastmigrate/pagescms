"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { requireApiSuccess } from "@/lib/api-client";
import type { Config } from "@/types/config";

interface ConfigContextType {
  config: Config | null;
  setConfig: (config: Config | null) => void;
  pendingConfig: Config | null | undefined;
  setUpdateBlocked: (blocked: boolean) => void;
  applyPendingConfig: () => void;
  refreshConfig: () => Promise<unknown>;
}
const ConfigContext = createContext<ConfigContextType | null>(null);
export const useConfig = () => {
  const context = useContext(ConfigContext);
  if (!context) throw new Error("useConfig must be used within a ConfigProvider");
  return context;
};
const fetchConfig = async (url: string): Promise<Config | null> => {
  const response = await fetch(url, { cache: "no-store" });
  const result = await requireApiSuccess<{ data: Config | null }>(response, "Failed to check configuration");
  return result.data;
};

export const ConfigProvider = ({ value, children, loadConfig }: {
  value: Config | null;
  children: React.ReactNode;
  loadConfig?: (url: string) => Promise<Config | null>;
}) => {
  const [config, updateConfig] = useState(value);
  const [pendingConfig, setPendingConfig] = useState<Config | null | undefined>(undefined);
  const blocked = useRef(false);
  const pending = useRef<Config | null | undefined>(undefined);
  const active = useRef(value);
  const pathname = usePathname();
  const url = value
    ? `/api/${value.owner}/${value.repo}/${encodeURIComponent(value.branch)}/configuration`
    : null;
  const { data, error, mutate } = useSWR(url, loadConfig ?? fetchConfig, {
    fallbackData: value ?? undefined,
    revalidateOnMount: false,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    refreshInterval: 60_000,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    dedupingInterval: 2_000,
  });
  const receive = useCallback((next: Config | null) => {
    const current = active.current;
    if (next && current && (next.owner !== current.owner || next.repo !== current.repo || next.branch !== current.branch)) return;
    if (next?.sha === current?.sha && next?.version === current?.version) {
      pending.current = undefined;
      setPendingConfig(undefined);
      return;
    }
    if (blocked.current) {
      pending.current = next;
      setPendingConfig(next);
    } else {
      active.current = next;
      updateConfig(next);
      pending.current = undefined;
      setPendingConfig(undefined);
    }
  }, []);
  // Server navigation and the external SWR subscription can each deliver new configuration.
  useEffect(() => { receive(value); }, [receive, value]);
  useEffect(() => { if (data !== undefined) receive(data); }, [data, receive]);
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      void mutate().catch(() => undefined);
    }
  }, [mutate, pathname]);
  const applyPendingConfig = useCallback(() => {
    blocked.current = false;
    if (pending.current !== undefined) receive(pending.current);
  }, [receive]);
  const setUpdateBlocked = useCallback((next: boolean) => {
    blocked.current = next;
    if (!next && pending.current !== undefined) receive(pending.current);
  }, [receive]);
  const setConfig = useCallback((next: Config | null) => {
    // A successful configuration save is authoritative for this client.
    active.current = next;
    updateConfig(next);
    pending.current = undefined;
    setPendingConfig(undefined);
    void mutate(next, { revalidate: false });
  }, [mutate]);
  const refreshConfig = useCallback(() => mutate().catch(() => undefined), [mutate]);
  const isConfigurationPage = value && pathname === `/${value.owner}/${value.repo}/${encodeURIComponent(value.branch)}/configuration`;
  const setupConfig = useMemo(() => value ? { ...value, sha: "", version: "", object: {} } : null, [value]);
  return <ConfigContext.Provider value={{ config: config ?? (isConfigurationPage ? setupConfig : null), setConfig, pendingConfig, setUpdateBlocked, applyPendingConfig, refreshConfig }}>
    {error && <div role="alert" className="border-b bg-destructive/10 p-3 text-sm">
      Configuration check failed. Your edits are kept. <button type="button" className="underline" onClick={() => void refreshConfig()}>Retry</button>
    </div>}
    {config || isConfigurationPage ? children : <div role="alert" className="p-6 space-y-3">
      <h1 className="text-xl font-semibold">Configuration not found</h1>
      <p>The configuration file or branch was removed. The old fields are no longer active.</p>
      <button type="button" className="underline" onClick={() => void refreshConfig()}>Check again</button>
      {value && <><p><Link className="underline" href={`/${value.owner}/${value.repo}`}>Open repository</Link></p>
        <p><Link className="underline" href={`/${value.owner}/${value.repo}/${encodeURIComponent(value.branch)}/configuration`}>Open configuration</Link></p></>}
    </div>}
  </ConfigContext.Provider>;
};
