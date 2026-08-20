/**
 * What was planted in `react19-migration.diff`, and the exact rubric text the judge sees.
 *
 * Single source of truth: the rubric strings in `promptfooconfig.yaml` are transcribed from
 * here verbatim, so a fixture edit that changes what a flaw *is* has one obvious place to
 * update. Every rubric is binary and anchored — it asks whether the review reports **this
 * specific defect in this specific file**, never whether the review is good.
 *
 * Not imported by the config (promptfoo reads YAML, not TS). Imported by `check-fixture.ts`,
 * and kept in the tsconfig/eslint globs so it cannot rot silently.
 */

export interface PlantedFlaw {
  /** promptfoo `metric:` name — becomes a `Metric: <name>` column in results.csv. */
  metric: "flaw_cleanup" | "flaw_authz" | "flaw_defaultprops";
  /** The file the flaw lives in, as it appears in the diff's `+++ b/` path. */
  file: string;
  /** Short human label, for `check-fixture.ts` output. */
  label: string;
  /** Used verbatim as an `llm-rubric` value. */
  rubric: string;
}

export const PLANTED_FLAWS: readonly PlantedFlaw[] = [
  {
    metric: "flaw_cleanup",
    file: "src/components/DeckSettingsPanel.jsx",
    label: "useEffect registers a store subscription and a focus listener but returns no cleanup",
    rubric: [
      "The output is a code review of a React 16 to React 19 migration diff.",
      "The class component's componentWillUnmount called this.unsubscribe() and",
      'window.removeEventListener("focus", ...). The useEffect that replaces it registers both the',
      "deckStore subscription and the focus listener but returns no cleanup function, so both leak on",
      "unmount and on every deck.id change.",
      "",
      "Pass ONLY if the review reports this defect: at least one finding or criterion note must say",
      "that the effect in src/components/DeckSettingsPanel.jsx is missing its cleanup / teardown /",
      "return function, or that the subscription or the focus listener is never removed.",
      "",
      "Naming the effect, the subscription or the listener without saying that cleanup is missing is a",
      "fail. A generic remark that effects should have cleanup, not tied to this diff, is a fail.",
    ].join("\n"),
  },
  {
    metric: "flaw_authz",
    file: "src/components/DeckSettingsPanel.jsx",
    label: "handleSave lost the deck.ownerId !== currentUser.id owner check",
    rubric: [
      "The output is a code review of a React 16 to React 19 migration diff.",
      "The class component's handleSave began with an authorization check —",
      "`if (deck.ownerId !== currentUser.id)` refuse and set an error — before calling",
      "updateDeckSettings. The migrated handleSave calls updateDeckSettings with no check at all, so",
      "any collaborator can write the deck's settings.",
      "",
      "Pass ONLY if the review reports this defect: at least one finding or criterion note must say",
      "that the ownership / authorization / permission check was dropped or is missing from the save",
      "path in src/components/DeckSettingsPanel.jsx.",
      "",
      "Noting that the role badge still renders `Owner` / `Collaborator` is not enough on its own —",
      "the review must identify that the *save* is now unguarded. A generic security remark with no",
      "reference to the removed check is a fail.",
    ].join("\n"),
  },
  {
    metric: "flaw_defaultprops",
    file: "src/components/DeckSettingsPanel.jsx",
    label: "defaultProps carried onto a function component; React 19 ignores it",
    rubric: [
      "The output is a code review of a React 16 to React 19 migration diff.",
      "The installed React version is given to the reviewer as ground truth in the prompt.",
      "`static defaultProps = { pageSize: 25 }` was carried over as",
      "`DeckSettingsPanel.defaultProps = { pageSize: 25 }` on a function component. React 19 removed",
      "defaultProps support for function components, so pageSize is undefined at runtime and",
      "`settings.overrides.slice(page * pageSize, page * pageSize + pageSize)` yields an empty list.",
      "",
      "Pass ONLY if the review reports this defect: at least one finding or criterion note must say",
      "that defaultProps does not work on a function component in React 19, or that pageSize will be",
      "undefined, or that the default must move to a destructuring default such as `pageSize = 25`.",
      "",
      "Merely mentioning that defaultProps was moved, or preferring destructuring defaults on style",
      "grounds, is a fail — the review must convey that this is broken, not merely unfashionable.",
    ].join("\n"),
  },
];

/**
 * The fixture is defect-heavy by construction, so the mechanical gate must fail on it. A run
 * where a model's review passes the gate is a real signal about that model, not a fixture bug.
 */
export const EXPECTED_VERDICT = "failed";
