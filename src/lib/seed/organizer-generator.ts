import { db } from '@/db';
import { insertCampaignUpdate } from '@/lib/echo-counters';
import * as schema from '@/db/schema';
import { eq, desc, count } from 'drizzle-orm';
import { callAI } from '@/lib/ai/call-ai';
import type { Campaign, CampaignOrganizer, CampaignUpdateType, CampaignCategory } from '@/types';

// ── Organizer Identity Generation ───────────────────────────────────────────

/**
 * Category-specific relation types for the simulated organizer.
 * The organizer is the person who "created" the fundraiser on the platform.
 */
const RELATION_BY_CATEGORY: Record<CampaignCategory, string[]> = {
  medical: ['spouse', 'sibling', 'parent', 'adult child', 'close friend', 'cousin'],
  disaster: ['neighbor', 'community leader', 'friend', 'coworker', 'church member'],
  military: ['spouse', 'parent', 'sibling', 'battle buddy', 'unit family readiness leader'],
  veterans: ['spouse', 'adult child', 'fellow veteran', 'VFW chapter member', 'friend'],
  memorial: ['spouse', 'sibling', 'adult child', 'parent', 'lifelong friend', 'coworker'],
  'first-responders': ['spouse', 'partner', 'station brother', 'friend', 'department colleague'],
  community: ['neighbor', 'community organizer', 'local business owner', 'friend', 'PTA member'],
  'essential-needs': ['social worker', 'neighbor', 'friend', 'church member', 'coworker'],
  emergency: ['sibling', 'friend', 'neighbor', 'coworker', 'parent'],
  charity: ['volunteer coordinator', 'board member', 'community advocate', 'friend'],
  education: ['teacher', 'parent', 'school counselor', 'coach', 'classmate\'s parent'],
  animal: ['shelter volunteer', 'neighbor', 'veterinary tech', 'animal rescue worker', 'friend'],
  environment: ['environmental advocate', 'neighbor', 'community volunteer', 'local activist'],
  business: ['business partner', 'employee', 'friend', 'mentor', 'industry colleague'],
  competition: ['teammate', 'coach', 'parent', 'friend', 'team manager'],
  creative: ['fellow artist', 'mentor', 'friend', 'gallery owner', 'teacher'],
  event: ['event coordinator', 'friend', 'community member', 'volunteer'],
  faith: ['pastor', 'church member', 'deacon', 'youth leader', 'fellow congregant'],
  family: ['sibling', 'cousin', 'parent', 'aunt/uncle', 'family friend'],
  sports: ['teammate', 'coach', 'team parent', 'friend', 'athletic trainer'],
  travel: ['travel companion', 'friend', 'family member', 'coworker'],
  volunteer: ['fellow volunteer', 'program coordinator', 'friend', 'mentor'],
  wishes: ['parent', 'sibling', 'friend', 'teacher', 'social worker'],
};

/**
 * Generate a simulated organizer identity for a campaign.
 * Uses AI to create a contextually appropriate name and city.
 * @param recentOrganizerNames - names already used in this batch to avoid repetition
 */
export async function generateOrganizerIdentity(
  campaign: Pick<Campaign, 'subjectName' | 'subjectHometown' | 'location' | 'category'>,
  recentOrganizerNames: string[] = [],
): Promise<CampaignOrganizer> {
  const relations = RELATION_BY_CATEGORY[campaign.category] ?? RELATION_BY_CATEGORY.community;
  const relation = relations[Math.floor(Math.random() * relations.length)];
  const hometown = campaign.subjectHometown ?? campaign.location ?? 'Unknown';

  const excludeClause = recentOrganizerNames.length > 0
    ? `\n- MUST NOT be any of these recently used names: ${recentOrganizerNames.join(', ')}`
    : '';

  const systemPrompt = `You generate a realistic name and city for a campaign organizer on a nonprofit fundraising platform. Return ONLY a JSON object with "name" (string) and "city" (string). No markdown.`;

  const userPrompt = `The campaign is for ${campaign.subjectName} from ${hometown}.
Category: ${campaign.category}
The organizer is their ${relation}.

Generate a realistic American name and a city near ${hometown} (same state or neighboring area) for this organizer.
The name should:
- Be a common American name appropriate for the relation type
- NOT be the same as ${campaign.subjectName}${excludeClause}
- Sound natural, not fictional
- Vary ethnicity and gender - do not default to common Anglo names

Return: {"name": "...", "city": "..."}`;

  try {
    const result = await callAI<{ name: string; city: string }>({
      systemPrompt,
      userPrompt,
      maxTokens: 256,
      promptType: 'generate-organizer',
    });

    return {
      name: result.name || 'A close friend',
      relation,
      city: result.city || hometown,
    };
  } catch {
    // Deterministic fallback - never fail campaign creation over organizer
    return {
      name: 'A close friend',
      relation,
      city: hometown,
    };
  }
}

// ── Organizer Update Scheduling ─────────────────────────────────────────────

/** Minimum days between organizer updates */
const MIN_UPDATE_INTERVAL_DAYS = 3;
/** Maximum days between organizer updates */
const MAX_UPDATE_INTERVAL_DAYS = 7;

/**
 * Update types that the organizer posts, with their relative weights.
 * The type is selected based on campaign progression and randomness.
 */
const UPDATE_TYPE_WEIGHTS: Record<CampaignUpdateType, number> = {
  phase_transition: 0, // handled by simulation-engine directly, not scheduled
  thank_you: 0.25,
  story_development: 0.25,
  disbursement_plan: 0.15,
  milestone_reflection: 0.15,
  community_response: 0.20,
  completion: 0, // handled by simulation-engine directly, not scheduled
  celebration: 0, // handled by simulation-engine directly, not scheduled
  impact_report: 0, // handled by simulation-engine directly, not scheduled
};

/**
 * Boosted weights for campaigns active > 7 days: story_development gets
 * increased weight to simulate narrative evolution.
 */
const UPDATE_TYPE_WEIGHTS_MATURE: Record<CampaignUpdateType, number> = {
  phase_transition: 0,
  thank_you: 0.20,
  story_development: 0.35,
  disbursement_plan: 0.10,
  milestone_reflection: 0.15,
  community_response: 0.20,
  completion: 0,
  celebration: 0,
  impact_report: 0,
};

/**
 * Select an organizer update type based on weighted random selection.
 * For campaigns active > 7 days, story_development gets boosted weight
 * to simulate narrative evolution (M6 deliverable 4).
 */
export function selectUpdateType(campaignAgeDays: number = 0): CampaignUpdateType {
  const weights = campaignAgeDays > 7
    ? UPDATE_TYPE_WEIGHTS_MATURE
    : UPDATE_TYPE_WEIGHTS;
  const schedulable = Object.entries(weights).filter(([, w]) => w > 0);
  const totalWeight = schedulable.reduce((sum, [, w]) => sum + w, 0);
  let rand = Math.random() * totalWeight;

  for (const [type, weight] of schedulable) {
    rand -= weight;
    if (rand <= 0) return type as CampaignUpdateType;
  }

  return 'thank_you';
}

/**
 * Is this update type one that should use editorial team voice?
 * community_response and milestone_reflection alternate between
 * organizer voice and editorial voice for variety.
 */
function isEditorialVoice(updateType: CampaignUpdateType): boolean {
  // community_response is always editorial voice
  if (updateType === 'community_response') return true;
  // milestone_reflection has 40% chance of being editorial
  if (updateType === 'milestone_reflection') return Math.random() < 0.4;
  return false;
}

/**
 * Check if a campaign is due for an organizer update.
 * Returns true if enough days have passed since the last organizer update.
 */
export async function isOrganizerUpdateDue(campaignId: string): Promise<boolean> {
  const [lastUpdate] = await db
    .select({ createdAt: schema.campaignUpdates.createdAt })
    .from(schema.campaignUpdates)
    .where(eq(schema.campaignUpdates.campaignId, campaignId))
    .orderBy(desc(schema.campaignUpdates.createdAt))
    .limit(1);

  if (!lastUpdate) return true; // No updates yet - overdue

  const daysSinceLastUpdate =
    (Date.now() - new Date(lastUpdate.createdAt).getTime()) / (1000 * 60 * 60 * 24);

  // Use a random threshold between MIN and MAX to avoid all campaigns updating the same day
  const threshold =
    MIN_UPDATE_INTERVAL_DAYS +
    Math.random() * (MAX_UPDATE_INTERVAL_DAYS - MIN_UPDATE_INTERVAL_DAYS);

  return daysSinceLastUpdate >= threshold;
}

/**
 * Generate and insert an organizer update for a campaign.
 * Fetches campaign context (age, donor count, previous updates) to produce
 * a contextually rich update that reads like a real organizer posting.
 * Some updates use editorial team voice for variety (M6 deliverable 3).
 */
export async function generateOrganizerUpdate(campaign: Campaign): Promise<void> {
  const organizer = campaign.campaignOrganizer as CampaignOrganizer | null;
  if (!organizer) return;

  // Gather context
  const publishedAt = campaign.publishedAt ?? campaign.createdAt;
  const ageDays = Math.floor(
    (Date.now() - new Date(publishedAt).getTime()) / (1000 * 60 * 60 * 24),
  );

  const updateType = selectUpdateType(ageDays);
  const useEditorial = isEditorialVoice(updateType);

  const percentage = campaign.goalAmount > 0
    ? Math.floor((campaign.raisedAmount / campaign.goalAmount) * 100)
    : 0;

  // Get previous updates for continuity
  const previousUpdates = await db
    .select({
      title: schema.campaignUpdates.title,
      updateType: schema.campaignUpdates.updateType,
      createdAt: schema.campaignUpdates.createdAt,
    })
    .from(schema.campaignUpdates)
    .where(eq(schema.campaignUpdates.campaignId, campaign.id))
    .orderBy(desc(schema.campaignUpdates.createdAt))
    .limit(5);

  // Get donor count
  const [donorCountResult] = await db
    .select({ value: count() })
    .from(schema.donations)
    .where(eq(schema.donations.campaignId, campaign.id));
  const donorCount = donorCountResult?.value ?? campaign.donorCount;

  // Get a short story summary (first 200 chars of storyHtml, stripped of tags)
  const storySummary = campaign.storyHtml
    .replace(/<[^>]+>/g, '')
    .slice(0, 200)
    .trim();

  const previousUpdateSummary = previousUpdates.length > 0
    ? previousUpdates
        .map((u) => `- "${u.title}" (${u.updateType ?? 'general'}, ${new Date(u.createdAt).toLocaleDateString()})`)
        .join('\n')
    : 'No previous updates posted.';

  // Voice selection: organizer (first-person) or editorial team (third-person)
  const systemPrompt = useEditorial
    ? `You write campaign update posts for a nonprofit fundraising platform called LastDonor. Write in THIRD PERSON as an editorial team member providing a thoughtful, journalistic update. Be warm, empathetic, and informative - like a community reporter covering a local story. Return ONLY plain text, no HTML, no markdown formatting.`
    : `You write campaign updates as a specific person - the campaign organizer - on a nonprofit fundraising platform. Write in FIRST PERSON as if you are ${organizer.name}, the ${organizer.relation} of the campaign subject. Be warm, personal, genuine, and specific. Never sound like AI or a corporation. Return ONLY plain text, no HTML, no markdown formatting.`;

  const userPrompt = buildOrganizerUpdateUserPrompt({
    updateType,
    useEditorial,
    organizerName: organizer.name,
    organizerRelation: organizer.relation,
    organizerCity: organizer.city,
    subjectName: campaign.subjectName,
    campaignTitle: campaign.title,
    category: campaign.category,
    ageDays,
    percentage,
    raisedAmount: campaign.raisedAmount,
    goalAmount: campaign.goalAmount,
    donorCount,
    storySummary,
    previousUpdateSummary,
  });

  try {
    const updateText = await callAI<string>({
      systemPrompt,
      userPrompt,
      parseJson: false,
      maxTokens: 1024,
      promptType: 'generate-organizer-update',
      campaignId: campaign.id,
    });

    const previousTitles = previousUpdates.map((u) => u.title);
    const title = buildUpdateTitle(updateType, organizer.name, campaign.subjectName, useEditorial, previousTitles);

    await insertCampaignUpdate({
      campaignId: campaign.id,
      title,
      bodyHtml: `<p>${updateText}</p>`,
      updateType,
    });
  } catch (error) {
    console.error(`Organizer update generation failed for campaign ${campaign.id}:`, error);
  }
}

// ── Prompt Builders ─────────────────────────────────────────────────────────

type OrganizerUpdatePromptInput = {
  updateType: CampaignUpdateType;
  useEditorial: boolean;
  organizerName: string;
  organizerRelation: string;
  organizerCity: string;
  subjectName: string;
  campaignTitle: string;
  category: string;
  ageDays: number;
  percentage: number;
  raisedAmount: number;
  goalAmount: number;
  donorCount: number;
  storySummary: string;
  previousUpdateSummary: string;
};

function buildOrganizerUpdateUserPrompt(input: OrganizerUpdatePromptInput): string {
  const raisedDollars = (input.raisedAmount / 100).toLocaleString();
  const goalDollars = (input.goalAmount / 100).toLocaleString();

  const voiceIntro = input.useEditorial
    ? `You are a member of the LastDonor editorial team writing about ${input.subjectName}'s campaign.`
    : `You are ${input.organizerName}, the ${input.organizerRelation} of ${input.subjectName}, writing from ${input.organizerCity}.`;

  return `${voiceIntro}

CAMPAIGN CONTEXT:
- Title: "${input.campaignTitle}"
- Category: ${input.category}
- Campaign age: ${input.ageDays} days
- Progress: ${input.percentage}% ($${raisedDollars} of $${goalDollars})
- Total donors: ${input.donorCount}

STORY BACKGROUND:
${input.storySummary}

PREVIOUS UPDATES POSTED:
${input.previousUpdateSummary}

UPDATE TYPE: ${formatUpdateType(input.updateType)}

${getUpdateTypeInstructions(input.updateType, input)}

WRITING RULES:
- Write 3-5 sentences ${input.useEditorial ? 'in third person as a compassionate editorial reporter' : `in first person as ${input.organizerName}`}
- Reference ${input.subjectName} by first name naturally
- Include at least one specific, personal detail (a memory, observation, or feeling)
- Match the emotional tone to the campaign's progress (${input.percentage}%)
- Do NOT repeat themes or phrases from previous updates
- Do NOT mention specific donation amounts or name individual donors
- ${input.useEditorial ? 'Write like a community journalist - warm but factual' : 'Sound like a real person posting on social media, not a professional writer'}
- Use natural paragraph breaks (2-3 short paragraphs)
- Vary sentence length - mix short punchy lines with longer ones`;
}

function formatUpdateType(type: CampaignUpdateType): string {
  const labels: Record<CampaignUpdateType, string> = {
    phase_transition: 'Phase Transition',
    thank_you: 'Thank You',
    story_development: 'Story Development',
    disbursement_plan: 'Disbursement Plan',
    milestone_reflection: 'Milestone Reflection',
    community_response: 'Community Response',
    completion: 'Completion',
    celebration: 'Celebration',
    impact_report: 'Impact Report',
  };
  return labels[type];
}

function getUpdateTypeInstructions(
  type: CampaignUpdateType,
  input: OrganizerUpdatePromptInput,
): string {
  switch (type) {
    case 'thank_you':
      return `INSTRUCTIONS FOR THIS UPDATE:
- Express genuine gratitude to the community of ${input.donorCount} donors
- Share how the support has impacted ${input.subjectName} emotionally
- Mention something specific that happened recently (a good day, a small win, a moment of hope)
- End with a forward-looking note about what this support means`;

    case 'story_development':
      return `INSTRUCTIONS FOR THIS UPDATE:
- Share a new development or anecdote about ${input.subjectName}'s situation
- This could be: a medical update, recovery progress, a new challenge, a small victory, an appointment result
- Continue the story - the campaign narrative should advance from the original story
- Examples of developments: "out of surgery," "test results came back," "found temporary housing," "started physical therapy"
- Make it feel like you're sharing real news with people who care
- Balance honesty about challenges with hope
- Ground it in a specific recent moment or conversation`;

    case 'disbursement_plan':
      return `INSTRUCTIONS FOR THIS UPDATE:
- Explain how the funds raised so far ($${(input.raisedAmount / 100).toLocaleString()}) will be used
- Be specific about categories (medical bills, housing, travel, supplies, etc.)
- Show transparency and accountability
- Thank donors for trusting you to manage this
- If early in campaign, describe planned use; if late, describe actual use`;

    case 'milestone_reflection':
      return `INSTRUCTIONS FOR THIS UPDATE:
- Reflect on reaching ${input.percentage}% of the goal
- Share what this milestone means personally to you and ${input.subjectName}
- Look back at where things started vs. where they are now
- Express what the community support has taught you
- Be emotional but genuine - not over-the-top`;

    case 'community_response':
      return `INSTRUCTIONS FOR THIS UPDATE:
- Highlight the community's response to ${input.subjectName}'s campaign
- Mention the collective effort of ${input.donorCount} donors coming together
- Share an observation about how the support has affected ${input.subjectName} or the family
- Reference the broader community: neighbors, local businesses, church groups, school communities
- Frame this as a community story - people helping people
- Be specific about the emotional impact rather than financial details`;

    default:
      return `INSTRUCTIONS: Write a general update about ${input.subjectName}'s campaign progress.`;
  }
}

/**
 * Title templates per update type - multiple options to avoid P5 repetition.
 * `{firstName}` = organizer first name, `{subjectFirst}` = subject first name.
 */
const ORGANIZER_TITLE_TEMPLATES: Record<string, string[]> = {
  thank_you: [
    'A message from {firstName}: Thank you all',
    '{firstName} says: We\'re overwhelmed by your support',
    'From {firstName}\'s heart to yours - thank you',
    'Grateful beyond words - a note from {firstName}',
    'To everyone who gave - thank you, from {firstName}',
  ],
  story_development: [
    'Update on {subjectFirst} from {firstName}',
    'News about {subjectFirst} - an update from the family',
    '{firstName} shares the latest on {subjectFirst}',
    'A new chapter: {subjectFirst}\'s journey continues',
    'What\'s happening with {subjectFirst} - {firstName} reports',
  ],
  disbursement_plan: [
    'How we\'re using your donations - from {firstName}',
    '{firstName} shares the plan for the funds',
    'Where your generosity is going - an update from {firstName}',
    'Putting your donations to work - {firstName}',
  ],
  milestone_reflection: [
    'Reflecting on this journey - {firstName}',
    '{firstName} looks back at how far we\'ve come',
    'A moment to pause and reflect - from {firstName}',
    'What this milestone means to us - {firstName}',
  ],
  community_response: [
    'The community rallies around {subjectFirst}',
    'How neighbors are showing up for {subjectFirst}',
    '{subjectFirst}\'s community responds with open hearts',
    'A community united: {subjectFirst}\'s support network grows',
    'The outpouring of love for {subjectFirst}',
  ],
};

/** Editorial team title templates (third-person voice). */
const EDITORIAL_TITLE_TEMPLATES: Record<string, string[]> = {
  community_response: [
    'Campaign spotlight: The community behind {subjectFirst}',
    'How donors are coming together for {subjectFirst}',
    'A community effort: {subjectFirst}\'s campaign update',
    '{subjectFirst}\'s story resonates - a LastDonor editorial',
  ],
  milestone_reflection: [
    'Campaign milestone: {subjectFirst}\'s progress so far',
    'Looking back on {subjectFirst}\'s fundraising journey',
    'A milestone moment for {subjectFirst}\'s campaign',
  ],
};

export function buildUpdateTitle(
  type: CampaignUpdateType,
  organizerName: string,
  subjectName: string,
  useEditorial: boolean = false,
  previousTitles: string[] = [],
): string {
  const firstName = organizerName.split(' ')[0];
  const subjectFirst = subjectName.split(' ')[0];

  // Pick from editorial or organizer templates
  const templateSource = useEditorial
    ? (EDITORIAL_TITLE_TEMPLATES[type] ?? ORGANIZER_TITLE_TEMPLATES[type])
    : ORGANIZER_TITLE_TEMPLATES[type];

  const templates = templateSource ?? [`Update from ${firstName} about ${subjectFirst}'s campaign`];

  // Generate all candidates
  const candidates = templates.map((t) =>
    t.replace(/\{firstName\}/g, firstName)
      .replace(/\{subjectFirst\}/g, subjectFirst),
  );

  // Prefer titles not already used
  const unused = candidates.filter(
    (c) => !previousTitles.some((prev) => prev === c),
  );

  const pool = unused.length > 0 ? unused : candidates;
  return pool[Math.floor(Math.random() * pool.length)];
}
