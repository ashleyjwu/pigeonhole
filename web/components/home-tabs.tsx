"use client";

import { useState } from "react";

import { Batch } from "@/components/batch";
import { Hero } from "@/components/hero";
import { Search } from "@/components/search";

type Tab = "now-playing" | "search" | "batch";

export function HomeTabs({ isDemo = false }: { isDemo?: boolean }) {
  const [tab, setTab] = useState<Tab>("now-playing");

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6">
      <div className="flex gap-1 rounded-full bg-neutral-900 p-1 text-sm">
        <TabButton active={tab === "now-playing"} onClick={() => setTab("now-playing")}>
          {isDemo ? "Sample track" : "Now playing"}
        </TabButton>
        <TabButton active={tab === "search"} onClick={() => setTab("search")}>
          Search
        </TabButton>
        <TabButton active={tab === "batch"} onClick={() => setTab("batch")}>
          Sort likes
        </TabButton>
      </div>
      {tab === "now-playing" ? (
        <Hero isDemo={isDemo} />
      ) : tab === "search" ? (
        <Search />
      ) : (
        <Batch />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-full bg-green-500 px-4 py-1.5 font-medium text-black"
          : "rounded-full px-4 py-1.5 text-neutral-400 hover:text-white"
      }
    >
      {children}
    </button>
  );
}
