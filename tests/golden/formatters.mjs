// How each terminal formatter is called for its golden snapshot. Shared by the
// generator (tests/golden/generate-formatters.mjs) and the test
// (tests/formatters-golden.test.js) so both render exactly the same way.
import { formatDiscoverSummary, formatCatalogSummary, formatIndexSummary, formatSearchResults } from "../../src/lib/catalog.js";
import { formatContextPackTerminal } from "../../src/lib/context-engine.js";
import { formatDoctorReport } from "../../src/lib/doctor.js";
import { formatImpactTerminal } from "../../src/lib/impact.js";
import { formatInitSummary } from "../../src/lib/init.js";
import { formatInstallSummary } from "../../src/lib/install.js";
import { formatTerminalSummary } from "../../src/lib/output.js";
import { formatPassTerminal } from "../../src/lib/pass-local.js";
import { formatPassPrTerminal } from "../../src/lib/pass-pr.js";
import { createRenderer } from "../../src/lib/render/fancy.js";
import { formatRouteTerminal } from "../../src/lib/render/route.js";
import { formatReportTerminal } from "../../src/lib/report.js";
import { formatReviewTerminal } from "../../src/lib/review.js";

/**
 * The renderer options every snapshot is taken with. Width is pinned so the
 * terminal size never leaks into a golden file.
 * @type {Record<string, { emoji: boolean, color: boolean, width: number }>}
 */
export const MODES = {
  "emoji-plain": { emoji: true, color: false, width: 78 },
  "ascii-plain": { emoji: false, color: false, width: 78 },
  "emoji-color": { emoji: true, color: true, width: 78 },
};

/**
 * Render one formatter's data under one mode.
 * @param {string} formatter
 * @param {any} data
 * @param {{ emoji: boolean, color: boolean, width: number }} mode
 * @returns {string}
 */
export function render(formatter, data, mode) {
  const factory = (/** @type {object} */ options) => createRenderer({ ...options, ...mode });
  switch (formatter) {
    case "context":
      return formatContextPackTerminal(data, factory);
    case "impact":
      return formatImpactTerminal(data, factory);
    case "pass":
      return formatPassTerminal(data, factory);
    case "pass-pr":
      return formatPassPrTerminal(data, factory);
    case "review":
      return formatReviewTerminal(data, factory);
    case "route":
      return formatRouteTerminal(data, createRenderer(mode));
    case "doctor":
      return formatDoctorReport(data, mode);
    case "report":
      return formatReportTerminal(data, { columns: mode.width, ...mode });
    case "summary":
      return formatTerminalSummary({ ...data, options: mode });
    case "discover":
      return formatDiscoverSummary(data, mode);
    case "index":
      return formatIndexSummary(data, mode);
    case "catalog":
      return formatCatalogSummary(data, mode);
    case "search":
      return formatSearchResults(data, mode);
    case "init":
      return formatInitSummary(data, mode);
    case "install":
      return formatInstallSummary(data, mode);
    default:
      throw new Error(`no golden renderer for ${formatter}`);
  }
}
