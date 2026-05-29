// GitHub PR merge-readiness gate ported from
// pullpass/internal/githubpr/evaluate.go. Drives `gh` through a small Runner
// abstraction so tests can swap in canned responses.

import path from "node:path";
import * as codeowners from "./codeowners.js";
import { defaultGhRunner } from "./gh.js";
import { gitRoot } from "./pass-local.js";
import { aggregateVerdict, normalizeGovernance, normalizeProfile, policyCheck, STATUS } from "./policy.js";
import { checkRelease } from "./release-check.js";
import { matchRiskPaths, matchSecretPaths } from "./risk-paths.js";
import { estimateTokens } from "./tokens.js";

const passPrEngineVersion = 1;
const PR_BASE_LABEL = "GitHub PR";

export async function evaluatePR(repoPath, selector, options = {}) {
  const profile = normalizeProfile(options.policy);
  const governance = normalizeGovernance(options.governance);
  const runner = options.runner ?? defaultGhRunner();

  const root = gitRoot(repoPath);
  const pr = viewPR(root, selector, runner);
  pr.statusCheckRollup = enrichStatusCheckAnnotations(root, pr.statusCheckRollup ?? [], runner);

  const files = (pr.files ?? []).map((entry) => entry.path).filter((p) => p && p.trim());

  const checks = [
    prStateCheck(pr),
    changedFilesCheck(files),
    secretCheck(files),
    riskCheck(files),
    checkRelease(root, files),
    reviewDecisionCheck(pr.reviewDecision, governance),
    codeownersCheckPR(root, files, pr.reviews ?? [], runner, governance),
    unresolvedConversationsCheck(root, pr.number, runner),
    branchProtectionCheck(root, pr.baseRefName, runner),
    statusChecksCheck(pr.statusCheckRollup ?? []),
  ];
  checks.push(policyCheck({ profile, governance, files, checks, remote: true }));

  const data = {
    ok: true,
    generatedAt: new Date().toISOString(),
    passPrEngineVersion,
    verdict: aggregateVerdict(checks),
    repo: { root, name: path.basename(root) },
    base: PR_BASE_LABEL,
    pr: {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      baseRefName: pr.baseRefName,
      isDraft: Boolean(pr.isDraft),
      mergeStateStatus: pr.mergeStateStatus ?? "",
      mergeable: pr.mergeable ?? "",
      reviewDecision: pr.reviewDecision ?? "",
    },
    policy: profile,
    governance,
    request: options.request ?? "",
    contextEvidence: contextEvidence(pr, options.request),
    changedFiles: files,
    checks,
  };
  data.tokenEstimate = { fullJson: estimateTokens(data) };
  return data;
}

function viewPR(root, selector, runner) {
  const args = ["pr", "view"];
  if (selector && String(selector).trim()) args.push(String(selector));
  args.push("--json", "number,title,url,baseRefName,isDraft,mergeStateStatus,mergeable,reviewDecision,files,reviews,statusCheckRollup");
  const out = runner.run(root, args);
  try {
    return JSON.parse(out);
  } catch (error) {
    throw new Error(`parse gh pr view response: ${error.message ?? String(error)}`);
  }
}

function nameWithOwner(root, runner) {
  const out = runner.run(root, ["repo", "view", "--json", "nameWithOwner"]);
  try {
    const parsed = JSON.parse(out);
    const value = String(parsed?.nameWithOwner ?? "").trim();
    if (!value) throw new Error("gh repo view returned empty nameWithOwner");
    return value;
  } catch (error) {
    throw new Error(`parse gh repo view response: ${error.message ?? String(error)}`);
  }
}

function changedFilesCheck(files) {
  if (files.length === 0) return { name: "Changed files", status: STATUS.warn, summary: "No changed files reported for this PR." };
  return {
    name: "Changed files",
    status: STATUS.pass,
    summary: `${files.length} changed file${files.length === 1 ? "" : "s"} reported.`,
    details: files.slice(0, 20),
  };
}

function secretCheck(files) {
  const matches = matchSecretPaths(files);
  if (matches.length > 0) {
    return { name: "Secret safety", status: STATUS.fail, summary: "Potential secret or environment file changed.", details: matches.slice(0, 20) };
  }
  return { name: "Secret safety", status: STATUS.pass, summary: "No obvious secret file changes found." };
}

function riskCheck(files) {
  const matches = matchRiskPaths(files);
  if (matches.length > 0) {
    return {
      name: "Risk review",
      status: STATUS.warn,
      summary: "Risk-sensitive files changed; maintainer review should be explicit.",
      details: matches.slice(0, 20),
    };
  }
  return { name: "Risk review", status: STATUS.pass, summary: "No obvious risk-sensitive file paths changed." };
}

function prStateCheck(pr) {
  const details = [`#${pr.number ?? 0} ${pr.title ?? ""}`.trim()];
  if (pr.url) details.push(pr.url);

  if (pr.isDraft) {
    return { name: "PR state", status: STATUS.fail, summary: "PR is a draft and should not merge.", details };
  }
  const mergeable = String(pr.mergeable ?? "").toUpperCase();
  const mergeState = String(pr.mergeStateStatus ?? "").toUpperCase();
  if (mergeable === "CONFLICTING" || mergeState === "DIRTY") {
    return { name: "PR state", status: STATUS.fail, summary: "PR has merge conflicts.", details };
  }
  if (mergeable === "UNKNOWN" || mergeState === "UNKNOWN" || mergeState === "") {
    return { name: "PR state", status: STATUS.warn, summary: "GitHub mergeability is not settled yet.", details };
  }
  if (mergeState === "BLOCKED" || mergeState === "UNSTABLE") {
    return { name: "PR state", status: STATUS.warn, summary: "GitHub reports the PR is not clean to merge yet.", details: [...details, mergeState] };
  }
  return { name: "PR state", status: STATUS.pass, summary: "PR is not draft and has no reported merge conflicts.", details };
}

function reviewDecisionCheck(decision, governance) {
  switch (
    String(decision ?? "")
      .trim()
      .toUpperCase()
  ) {
    case "APPROVED":
      return { name: "Review decision", status: STATUS.pass, summary: "GitHub reports the PR is approved." };
    case "CHANGES_REQUESTED":
      return { name: "Review decision", status: STATUS.fail, summary: "GitHub reports requested changes." };
    case "REVIEW_REQUIRED":
      if (governance === "solo") {
        return {
          name: "Review decision",
          status: STATUS.warn,
          summary: "Solo-maintainer owner decision is required; no separate GitHub approval is recorded.",
          details: ["Record the owner/admin merge decision before merging.", "Use team governance when a separate reviewer is required."],
        };
      }
      return { name: "Review decision", status: STATUS.fail, summary: "A required human review is still missing." };
    case "":
      return { name: "Review decision", status: STATUS.warn, summary: "GitHub did not return a review decision; verify required reviewers manually." };
    default:
      return { name: "Review decision", status: STATUS.warn, summary: `Unrecognized review decision: ${decision}` };
  }
}

function codeownersCheckPR(root, files, reviews, runner, governance) {
  const loaded = codeowners.load(root);
  if (!loaded.ok) {
    if (loaded.missing) {
      return { name: "CODEOWNERS", status: STATUS.warn, summary: "No CODEOWNERS file found; ownership checks are unavailable." };
    }
    return { name: "CODEOWNERS", status: STATUS.warn, summary: `Could not read CODEOWNERS: ${loaded.error?.message ?? "unknown error"}` };
  }
  const ruleset = loaded.ruleset;
  if (ruleset.rules.length === 0) {
    return { name: "CODEOWNERS", status: STATUS.warn, summary: "CODEOWNERS exists but contains no usable owner rules.", details: [ruleset.path] };
  }

  const owned = codeowners.ownedFiles(ruleset, files);
  if (owned.length === 0) {
    return { name: "CODEOWNERS", status: STATUS.pass, summary: "No changed files matched CODEOWNERS.", details: [ruleset.path] };
  }

  const approved = approvedReviewers(reviews);
  const missing = [];
  const manual = [];

  for (const entry of owned) {
    const direct = codeowners.directUserOwners(entry.owners);
    if (direct.some((user) => approved.has(user.toLowerCase()))) continue;

    const detail = `${entry.path} -> ${entry.owners.join(", ")}`;
    const teams = codeowners.teamOwners(entry.owners);
    let teamApproved = false;
    const teamErrors = [];
    for (const team of teams) {
      try {
        if (teamHasApprovedReviewer(root, team, approved, runner)) {
          teamApproved = true;
          break;
        }
      } catch (error) {
        teamErrors.push(`${detail} (${team.owner}: ${error.message ?? String(error)})`);
      }
    }
    if (teamApproved) continue;

    if (teamErrors.length > 0 || codeowners.hasExternalOwner(entry.owners)) {
      manual.push(detail, ...teamErrors);
      continue;
    }
    if (teams.length > 0) {
      missing.push(detail);
      continue;
    }
    if (codeowners.hasTeamOrExternalOwner(entry.owners)) {
      manual.push(detail);
      continue;
    }
    missing.push(detail);
  }

  if (missing.length > 0) {
    if (governance === "solo") {
      return {
        name: "CODEOWNERS",
        status: STATUS.warn,
        summary: "CODEOWNERS approval is missing; solo-maintainer mode requires an explicit owner/admin merge decision.",
        details: [...missing, "Use team governance when CODEOWNERS approval must come from a separate reviewer."],
      };
    }
    return { name: "CODEOWNERS", status: STATUS.fail, summary: "CODEOWNERS approval is missing for one or more changed files.", details: missing };
  }
  if (manual.length > 0) {
    return { name: "CODEOWNERS", status: STATUS.warn, summary: "Some CODEOWNERS could not be verified automatically.", details: manual };
  }
  return { name: "CODEOWNERS", status: STATUS.pass, summary: "Changed files have verified CODEOWNERS approval.", details: [ruleset.path] };
}

function approvedReviewers(reviews) {
  const approved = new Set();
  for (const review of reviews ?? []) {
    const login = String(review?.author?.login ?? "")
      .trim()
      .toLowerCase();
    if (!login) continue;
    const state = String(review?.state ?? "")
      .trim()
      .toUpperCase();
    if (state === "APPROVED") approved.add(login);
    else if (state === "CHANGES_REQUESTED" || state === "DISMISSED") approved.delete(login);
  }
  return approved;
}

function teamHasApprovedReviewer(root, team, approved, runner) {
  for (const login of [...approved].sort()) {
    if (teamMembership(root, team, login, runner)) return true;
  }
  return false;
}

function teamMembership(root, team, login, runner) {
  const endpoint = `orgs/${encodeURIComponent(team.org)}/teams/${encodeURIComponent(team.slug)}/memberships/${encodeURIComponent(login)}`;
  let out;
  try {
    out = runner.run(root, ["api", endpoint]);
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
  try {
    const parsed = JSON.parse(out);
    return (
      String(parsed?.state ?? "")
        .trim()
        .toLowerCase() === "active"
    );
  } catch (error) {
    throw new Error(`parse gh team membership response: ${error.message ?? String(error)}`);
  }
}

function unresolvedConversationsCheck(root, prNumber, runner) {
  if (!prNumber) {
    return { name: "Review conversations", status: STATUS.warn, summary: "PR number is unavailable; review conversations could not be inspected." };
  }
  let threads;
  try {
    threads = reviewThreads(root, prNumber, runner);
  } catch (error) {
    return { name: "Review conversations", status: STATUS.warn, summary: `Could not inspect review conversations: ${error.message ?? String(error)}` };
  }
  const unresolved = threads.filter((thread) => !thread.isResolved).map(threadDetail);
  if (unresolved.length > 0) {
    return { name: "Review conversations", status: STATUS.fail, summary: "Unresolved PR review conversations remain.", details: unresolved };
  }
  return { name: "Review conversations", status: STATUS.pass, summary: "No unresolved PR review conversations found." };
}

const REVIEW_THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        nodes {
          isResolved
          path
          line
          startLine
          comments(first: 1) {
            nodes {
              author { login }
              url
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}`;

function reviewThreads(root, prNumber, runner) {
  const name = nameWithOwner(root, runner);
  const slash = name.indexOf("/");
  if (slash <= 0) throw new Error(`invalid nameWithOwner: ${name}`);
  const owner = name.slice(0, slash);
  const repo = name.slice(slash + 1);

  const threads = [];
  let cursor = "";
  for (;;) {
    const args = ["api", "graphql", "-f", `query=${REVIEW_THREADS_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${repo}`, "-F", `number=${prNumber}`];
    if (cursor) args.push("-F", `cursor=${cursor}`);
    const out = runner.run(root, args);
    let parsed;
    try {
      parsed = JSON.parse(out);
    } catch (error) {
      throw new Error(`parse gh review threads response: ${error.message ?? String(error)}`);
    }
    const page = parsed?.data?.repository?.pullRequest?.reviewThreads ?? { nodes: [], pageInfo: { hasNextPage: false } };
    threads.push(...(page.nodes ?? []));
    if (!page.pageInfo?.hasNextPage) break;
    if (!page.pageInfo.endCursor) throw new Error("reviewThreads has next page but no endCursor");
    cursor = page.pageInfo.endCursor;
  }
  return threads;
}

function threadDetail(thread) {
  let location = thread.path ?? "";
  let line = thread.line ?? 0;
  if (!line) line = thread.startLine ?? 0;
  if (line > 0) location += `:${line}`;
  const first = thread.comments?.nodes?.[0];
  if (!first) return location;
  const author = String(first.author?.login ?? "").trim();
  if (author) location += ` by @${author}`;
  if (first.url) location += ` ${first.url}`;
  return location;
}

function branchProtectionCheck(root, branch, runner) {
  const trimmed = String(branch ?? "").trim();
  if (!trimmed) {
    return { name: "Branch protection", status: STATUS.warn, summary: "Base branch is unavailable; branch protection could not be inspected." };
  }
  let protection;
  let exists;
  try {
    ({ protection, exists } = branchProtection(root, trimmed, runner));
  } catch (error) {
    return { name: "Branch protection", status: STATUS.warn, summary: `Could not inspect branch protection: ${error.message ?? String(error)}` };
  }
  if (!exists) {
    return { name: "Branch protection", status: STATUS.warn, summary: "Base branch is not protected.", details: [trimmed] };
  }

  const issues = [];
  const reviews = protection.required_pull_request_reviews;
  if (!reviews) {
    issues.push("Pull request reviews are not required.");
  } else {
    if ((reviews.required_approving_review_count ?? 0) < 1) issues.push("At least one approving review is not required.");
    if (!reviews.require_code_owner_reviews) issues.push("CODEOWNERS review is not required by branch protection.");
  }
  const statusChecks = protection.required_status_checks;
  const hasStatusContexts = (statusChecks?.contexts?.length ?? 0) > 0 || (statusChecks?.checks?.length ?? 0) > 0;
  if (!statusChecks || !hasStatusContexts) issues.push("Required status checks are not configured.");
  if (!protection.required_conversation_resolution?.enabled) issues.push("Conversation resolution is not required by branch protection.");
  if (protection.allow_force_pushes?.enabled) issues.push("Force pushes are allowed.");
  if (protection.allow_deletions?.enabled) issues.push("Branch deletion is allowed.");

  if (issues.length > 0) {
    return { name: "Branch protection", status: STATUS.warn, summary: "Branch protection is present but missing recommended safeguards.", details: issues };
  }
  return {
    name: "Branch protection",
    status: STATUS.pass,
    summary: "Base branch protection requires reviews, status checks, CODEOWNERS, and conversation resolution.",
    details: [trimmed],
  };
}

function branchProtection(root, branch, runner) {
  const name = nameWithOwner(root, runner);
  const slash = name.indexOf("/");
  if (slash <= 0) throw new Error(`invalid nameWithOwner: ${name}`);
  const owner = name.slice(0, slash);
  const repo = name.slice(slash + 1);
  const endpoint = `repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}/protection`;
  let out;
  try {
    out = runner.run(root, ["api", endpoint]);
  } catch (error) {
    if (isBranchNotProtected(error) || isNotFound(error)) return { protection: null, exists: false };
    throw error;
  }
  try {
    return { protection: JSON.parse(out), exists: true };
  } catch (error) {
    throw new Error(`parse gh branch protection response: ${error.message ?? String(error)}`);
  }
}

function statusChecksCheck(checks) {
  if (!checks || checks.length === 0) {
    return { name: "Status checks", status: STATUS.warn, summary: "No status checks found on the PR." };
  }
  const failing = [];
  const pending = [];
  for (const check of checks) {
    const conclusion = String(check.conclusion ?? "").toUpperCase();
    const status = String(check.status ?? check.state ?? "").toUpperCase();
    if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(conclusion)) continue;
    if (["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "CANCELLED", "STALE"].includes(conclusion)) {
      failing.push(statusCheckDetail(check, conclusion));
      continue;
    }
    if (conclusion === "") {
      if (status !== "COMPLETED") pending.push(statusCheckDetail(check, status || "PENDING"));
      continue;
    }
    failing.push(statusCheckDetail(check, conclusion));
  }
  if (failing.length > 0) return { name: "Status checks", status: STATUS.fail, summary: "One or more status checks failed.", details: failing };
  if (pending.length > 0) return { name: "Status checks", status: STATUS.warn, summary: "One or more status checks are still pending.", details: pending };
  return { name: "Status checks", status: STATUS.pass, summary: "All returned status checks passed." };
}

function statusCheckDetail(check, state) {
  const name = firstNonEmpty(check.name, check.context, check.workflowName, "unnamed check");
  let detail = `${name}: ${state}`;
  const parts = [];
  const workflow = String(check.workflowName ?? "").trim();
  if (workflow && workflow !== name) parts.push(`workflow: ${workflow}`);
  if (check.detailsUrl) parts.push(`details: ${check.detailsUrl}`);
  parts.push(...annotationDetails(check.annotations ?? []));
  if (parts.length > 0) detail += ` (${parts.join("; ")})`;
  return detail;
}

function annotationDetails(annotations) {
  const out = [];
  for (const annotation of annotations) {
    const message = String(annotation.message ?? "").trim();
    if (!message) continue;
    const label = isCIReadinessAnnotation(message) ? "ci readiness" : "annotation";
    out.push(`${label}: ${message}`);
    if (out.length >= 3) break;
  }
  return out;
}

function isCIReadinessAnnotation(message) {
  const text = message.toLowerCase();
  return text.includes("job was not started") || text.includes("spending limit") || text.includes("payments have failed") || text.includes("billing");
}

function enrichStatusCheckAnnotations(root, checks, runner) {
  let name;
  const enriched = [...checks];
  for (let i = 0; i < enriched.length; i += 1) {
    const check = enriched[i];
    if (!shouldFetchAnnotations(check)) continue;
    const checkRunId = checkRunIdFromDetailsUrl(check.detailsUrl);
    if (!checkRunId) continue;
    if (!name) {
      try {
        name = nameWithOwner(root, runner);
      } catch {
        return enriched;
      }
    }
    try {
      const out = runner.run(root, ["api", `repos/${name}/check-runs/${checkRunId}/annotations`]);
      const annotations = JSON.parse(out);
      if (Array.isArray(annotations)) enriched[i] = { ...check, annotations };
    } catch {
      // best-effort; skip enrichment on error
    }
  }
  return enriched;
}

function shouldFetchAnnotations(check) {
  const conclusion = String(check.conclusion ?? "").toUpperCase();
  if (!["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "CANCELLED", "STALE"].includes(conclusion)) return false;
  return Boolean(String(check.detailsUrl ?? "").trim());
}

function checkRunIdFromDetailsUrl(detailsUrl) {
  try {
    const url = new URL(String(detailsUrl ?? "").trim());
    const parts = url.pathname.split("/").filter(Boolean);
    for (let i = 0; i < parts.length; i += 1) {
      if (parts[i] === "job" && parts[i + 1]) return parts[i + 1];
    }
  } catch {
    // fall through
  }
  return "";
}

function contextEvidence(pr, request) {
  const subject = String(request ?? pr.title ?? "review this pull request").trim() || "review this pull request";
  const evidence = [`repoctx impact . ${JSON.stringify(subject)} --json`];
  if (pr.number) evidence.push(`repoctx pr . --number ${pr.number} --out .dev-context/pr-review.md`);
  else if (pr.baseRefName) evidence.push(`repoctx pr . --base ${pr.baseRefName} --out .dev-context/pr-review.md`);
  else evidence.push("repoctx pr . --out .dev-context/pr-review.md");
  return evidence;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function isBranchNotProtected(error) {
  const text = String(error?.message ?? "").toLowerCase();
  return text.includes("branch not protected");
}

function isNotFound(error) {
  const text = String(error?.message ?? "").toLowerCase();
  return text.includes("http 404") || text.includes(`"status":"404"`) || text.includes("not found");
}

// Renderers reuse the pass-local layout, just with a richer header.
const STATUS_TO_RENDER = { PASS: "pass", WARN: "warn", FAIL: "fail" };

export function formatPassPrTerminal(data, rendererFactory) {
  const renderer = rendererFactory({});
  const lines = [];
  const sub = [
    { text: data.pr.title ? `#${data.pr.number ?? "?"} ${data.pr.title}` : `#${data.pr.number ?? "?"}`, glyph: "🔖" },
    { text: data.pr.url || `${data.repo.root}`, glyph: data.pr.url ? "🔗" : "📂" },
    { text: `base: ${data.pr.baseRefName || "?"} · policy: ${data.policy} · governance: ${data.governance}`, glyph: "⚙️" },
  ];
  lines.push(renderer.header({ text: "repoctx pass-pr · GitHub merge readiness", glyph: "📋" }, sub));
  lines.push("");

  for (const check of data.checks) {
    const status = STATUS_TO_RENDER[check.status] ?? "info";
    const details = (check.details ?? []).slice(0, 10);
    lines.push(renderer.statusLine(status, check.name, check.summary, details));
  }

  lines.push("");
  const blocked = data.checks.find((entry) => entry.status === STATUS.fail);
  const warning = data.checks.find((entry) => entry.status === STATUS.warn);
  lines.push(
    renderer.verdict({
      verdict: data.verdict,
      blockedBy: blocked ? blocked.name : undefined,
      nextStep: nextStep(data, blocked, warning),
    }),
  );

  lines.push("");
  lines.push(`  ${renderer.emoji ? "💡" : "[i]"}  Context evidence:`);
  for (const command of data.contextEvidence) lines.push(`     ${renderer.emoji ? "•" : "-"} ${command}`);
  return lines.join("\n");
}

function nextStep(data, blocked, warning) {
  if (blocked) return `address ${blocked.name.toLowerCase()} before merge`;
  if (warning) return "review the warning before merge";
  return data.changedFiles.length === 0 ? "no changes reported" : "ready to merge";
}

export function formatPassPrMarkdown(data) {
  const lines = [
    `# repoctx pass-pr: #${data.pr.number ?? "?"} ${data.pr.title ?? ""}`.trim(),
    "",
    `Verdict: **${data.verdict}**`,
    `Repository: \`${data.repo.root}\``,
    `Base: \`${data.pr.baseRefName ?? ""}\``,
    `Policy: \`${data.policy}\``,
    `Governance: \`${data.governance}\``,
    data.pr.url ? `PR: ${data.pr.url}` : "",
    "",
    "## Context Evidence",
    "",
    ...data.contextEvidence.map((command) => `- \`${command}\``),
    "",
    "## Changed Files",
    "",
    ...(data.changedFiles.length ? data.changedFiles.map((file) => `- \`${file}\``) : ["- (no changes reported)"]),
    "",
    "## Checks",
    "",
  ];
  for (const check of data.checks) {
    lines.push(`### ${check.status}  ·  ${check.name}`);
    lines.push("");
    lines.push(check.summary);
    if (check.details && check.details.length) {
      lines.push("");
      for (const detail of check.details) lines.push(`- ${detail}`);
    }
    lines.push("");
  }
  return lines.filter((line, index, all) => !(line === "" && all[index - 1] === "")).join("\n");
}
