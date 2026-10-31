"use client";

import { createContext, useContext, useState } from "react";
import { Repo } from "@/types/repo";
import type { getRawUrl } from "@/lib/github-image";

interface RepoContextType extends Repo {
  setBranches: (branches: string[]) => void;
  resolveImageUrl?: typeof getRawUrl;
}

const RepoContext = createContext<RepoContextType | undefined>(undefined);

export const useRepo = () => {
  const context = useContext(RepoContext);
  if (!context) {
    throw new Error("useRepo must be used within a RepoProvider");
  }
  return context;
};

export const RepoProvider = ({
  repo,
  children,
  resolveImageUrl,
}: {
  repo: Repo;
  children: React.ReactNode;
  resolveImageUrl?: typeof getRawUrl;
}) => {
  const [branches, setBranches] = useState<string[]>(repo?.branches || []);

  return (
    <RepoContext.Provider value={{ ...repo, branches, setBranches, resolveImageUrl }}>
      {children}
    </RepoContext.Provider>
  );
};
