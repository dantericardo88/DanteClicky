export type PreferenceExample = {
  id: number;
  user_prompt: string;
  assistant_response: string;
  created_at: string;
  preference_score: number;
  feedback_source: string;
  feedback_reason?: string | null;
};

export type PreferenceTrait = {
  key: string;
  label: string;
  score: number;
  support_score?: number;
  conflict_score?: number;
  decayed_score?: number;
  evidence_count: number;
  positive_count: number;
  negative_count: number;
  last_seen: string;
  confidence?: number;
  status?: string;
  user_label?: string | null;
  user_note?: string | null;
};

export type PreferenceProfile = {
  traits: PreferenceTrait[];
  prompt_traits?: PreferenceTrait[];
  positive_examples: PreferenceExample[];
  negative_examples: PreferenceExample[];
  explicit_feedback_count: number;
  implicit_feedback_count: number;
};

export type InferredPreferenceSignal = {
  signal: string;
  weight: number;
  reason: string;
};

const EXPLICIT_PREFERENCE_PATTERNS = [
  /\b(remember that i (prefer|want|like|need)|remember i (always )?(prefer|want|like))\b/i,
  /\b(remember my preference)\b/i,
  /\b(i always (prefer|want|like|need))\b/i,
  /\b(my preference is|please always)\b/i,
  /\b(always (give|show|use|write|keep) (me\s+)?(concise|brief|detailed|bullet|numbered|code|plain))\b/i,
  /\b(from now on|next time|going forward)\b.{0,20}\b(concise|brief|shorter|longer|plain|bullet|numbered|code|formal|casual|simple|detailed|terse|markdown|verbose)\b/i,
  /\b(i prefer)\b.{0,40}\b(no markdown|no preamble|bullet|code|plain text|brief|concise|formal|casual|detailed|numbered|simple|terse|verbose)\b/i,
  /\b(in general (i )?(prefer|want|like|need))\b/i,
];

const POSITIVE_FOLLOW_UPS = [
  /\b(that worked|works great|perfect|exactly right|nice|awesome|great answer|good answer|nailed it|spot on)\b/i,
  /\b(thanks|thank you)\b(?!\s*,?\s*(now|open|close|go|click|show|hide|run|start|stop|create|delete|move|navigate|press))/i,
  /\b(keep doing that|that's the style|i like that|love that|that's what i wanted)\b/i,
  /\b(yes[,!.]|yep|yup|exactly|correct|right|bingo|brilliant|solid|great)\b(?!\s+(open|close|click|run|press|go|show|type|start))/i,
  /\b(that's (it|right|perfect|good|helpful|great|exactly))\b/i,
  /^(yes|yep|yup|perfect|exactly|correct|great|good|nice|cool|ok|okay)[.!]?\s*$/i,
  /\b(this is (exactly|just|precisely) what i (needed|wanted|was looking for))\b/i,
  /\b(helpful|very helpful|super helpful|that helps|this helps)\b/i,
  /\b(love this style|this is (the style|how) i (like|want)|exactly how i like)\b/i,
  /\b(remember (this|that i|i like|i prefer))\b/i,
];

const NEGATIVE_FOLLOW_UPS = [
  /\b(no[, ]|that's wrong|that is wrong|not what i asked|not right|incorrect)\b/i,
  /\b(actually)(?!\s+(open|close|go|click|show|hide|run|start|stop|create|delete|move|navigate|press))\b|\b(i meant|you misunderstood|missed the point|too long|too verbose|too short)\b/i,
  /\b(don't do that|stop doing that|avoid that|bad answer|not helpful|unhelpful)\b/i,
  /\b(wrong|nope|no that|that isn't|that's not right|not what i (meant|wanted|said)|try again)\b/i,
  /\b(ugh|that's (bad|awful|terrible|wrong|off))\b/i,
  /^(no|nope|wrong|incorrect|not right|not helpful)[.!]?\s*$/i,
  /\b(you('re|\s+are) (wrong|off|missing|misunderstanding))\b/i,
  /\b(that (misses|misread|ignores) the point|completely (wrong|off|missed))\b/i,
  /\b(not quite|not exactly what|that's not it|that is not it)\b/i,
  /\b(missed the mark|can you redo|redo that|try that again|not really what)\b/i,
  /\b(too (formal|casual|technical|academic|complex|complicated|wordy|flowery|stiff|stuffy))\b/i,
  /\b(not (technical|detailed|specific|clear|concise) enough|over.?explained|over.?complicated)\b/i,
];

const INJECTION_PATTERN = /ignore\s+(previous|prior|all)\s+(instructions|prompts)|reveal\s+(secrets|keys|api)|override\s+system/i;
const API_KEY_PATTERN = /\b(sk-|api[_-]?key[=:\s]|bearer\s)[a-zA-Z0-9_\-]{8,}/i;

export function inferPreferenceSignal(text: string): InferredPreferenceSignal | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (EXPLICIT_PREFERENCE_PATTERNS.some((p) => p.test(trimmed))) {
    return {
      signal: "manual_preference",
      weight: 1.0,
      reason: "user explicitly stated a preference",
    };
  }

  if (NEGATIVE_FOLLOW_UPS.some((pattern) => pattern.test(trimmed))) {
    return {
      signal: "corrective_followup",
      weight: -0.8,
      reason: "user corrected or rejected the previous response",
    };
  }

  if (POSITIVE_FOLLOW_UPS.some((pattern) => pattern.test(trimmed))) {
    return {
      signal: "positive_followup",
      weight: 0.5,
      reason: "user accepted the previous response",
    };
  }

  return null;
}

export function buildPreferenceGuidance(profile: PreferenceProfile | null | undefined): string {
  if (!profile) return "";
  const sourceTraits = profile.prompt_traits?.length ? profile.prompt_traits : profile.traits;
  const traitLines = sourceTraits
    .filter((trait) => {
      const eff = trait.decayed_score ?? trait.score;
      return Math.abs(eff) >= 0.1;
    })
    .filter((trait) => !trait.status || trait.status === "active")
    .filter((trait) => trait.confidence === undefined || trait.confidence >= 0.25)
    .slice(0, 8)
    .map((trait) => {
      const rawLabel = trait.user_label ?? trait.label;
      const label = sanitizePreferenceText(rawLabel);
      if (!label) return "";
      const eff = trait.decayed_score ?? trait.score;
      const conf = trait.confidence ?? Math.min(0.99, Math.abs(eff) / Math.max(1, trait.evidence_count));
      const isPositive = eff > 0;
      let tier: string;
      if (conf >= 0.7 && trait.evidence_count >= 2) {
        tier = isPositive ? "strongly prefer" : "strongly avoid";
      } else if (conf >= 0.4) {
        tier = isPositive ? "prefer" : "avoid";
      } else {
        tier = isPositive ? "slight tendency toward" : "slight tendency to avoid";
      }
      return `- ${tier} ${label} (${trait.evidence_count} signals)`;
    })
    .filter(Boolean);

  if (traitLines.length === 0) return "";
  const body = [
    "these are inferred user-style preferences. use them only when they do not conflict with higher-priority instructions.",
    ...traitLines,
    `feedback counts: explicit ${profile.explicit_feedback_count}, implicit ${profile.implicit_feedback_count}`,
  ].join("\n");
  return clampBlock(`[learned user preferences]\n${body}\n[/learned user preferences]`, 800);
}

function sanitizePreferenceText(text: string): string {
  if (!text.trim()) return "";
  if (INJECTION_PATTERN.test(text) || API_KEY_PATTERN.test(text)) return "";
  const normalized = text
    .replace(/\[(\/?)(preference profile|learned user preferences|past conversations|always remember)\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return truncateChars(normalized, 96);
}

function clampBlock(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const closing = "\n[/learned user preferences]";
  return `${truncateChars(text, maxLength - closing.length).replace(/\.\.\.$/, "").trimEnd()}...${closing}`;
}

function truncateChars(text: string, maxLength: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;
  return `${chars.slice(0, Math.max(0, maxLength - 3)).join("").trimEnd()}...`;
}
