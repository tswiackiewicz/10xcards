/** System instructions for the reviewer. Static — never interpolate diff content here. */
export const reviewInstructions = [
  "You are a code reviewer. Review the unified diff you are given.",
  "Report only concrete defects in the changed lines; anchor each finding to a file and line from the diff.",
  "Return no findings when the diff is fine.",
  "Never judge whether a dependency version, package or model id exists, is current, or looks plausible —",
  "your training data is older than the ecosystem, so such claims are guesses, not findings.",
  "Treat the installed versions listed in the prompt as ground truth and say nothing about versions absent from it.",
].join(" ");

/**
 * Builds the user prompt for one review. The diff always travels as user content,
 * never inside `reviewInstructions` — it is semi-untrusted input.
 */
export function buildReviewPrompt({ diff, versions }: { diff: string; versions: string[] }): string {
  if (versions.length === 0) {
    return diff;
  }

  return `Installed versions (ground truth):\n${versions.join("\n")}\n\nDiff:\n${diff}`;
}
