export function getToolMatrix() {
  return {
    ok: true,
    tools: [
      {
        name: "Greploop",
        role: "Problem pattern",
        pilotUse: "Frame the problem",
        notes: "Repeated search/read/retry behavior that wastes agent context.",
      },
      {
        name: "code-structure",
        role: "TypeScript structure HTML generator",
        pilotUse: "Wrap as baseline",
        notes: "Useful for visual structure output, but old and narrow.",
      },
      {
        name: "opensrc",
        role: "Dependency source lookup",
        pilotUse: "Integrate directly",
        notes: "Provides package source paths that can be searched by rg or fallback search.",
      },
      {
        name: "Daytona",
        role: "Sandbox execution",
        pilotUse: "Phase 2 adapter",
        notes: "Use when generated code or tests need isolated execution.",
      },
      {
        name: "Harnss",
        role: "Agent UI/control surface",
        pilotUse: "Future UI reference",
        notes: "Use as inspiration for multi-agent orchestration and tool-call visibility.",
      },
    ],
  };
}
