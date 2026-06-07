import type { CampaignHook, CampaignPack } from "./campaignPack.js";

export interface SpoilerFreeMysteryBrief {
  campaign: {
    id: string;
    title: string;
    genre?: string;
    tone: string[];
    rulesetStyle: string;
    recommendedGroupSize?: string;
    contentWarnings: string[];
    hooks: CampaignHook[];
  };
  mystery: {
    id: string;
    title: string;
    hook: string;
  };
}

export function spoilerFreeMysteryBrief(pack: CampaignPack, mysteryId: string): SpoilerFreeMysteryBrief {
  const mystery = pack.mysteries.find((item) => item.id === mysteryId);
  if (!mystery) {
    throw new Error(`Campaign mystery not found: ${mysteryId}`);
  }

  return {
    campaign: {
      id: pack.id,
      title: pack.title,
      ...(pack.genre ? { genre: pack.genre } : {}),
      tone: pack.tone,
      rulesetStyle: pack.rulesetStyle,
      ...(pack.recommendedGroupSize ? { recommendedGroupSize: pack.recommendedGroupSize } : {}),
      contentWarnings: pack.contentWarnings,
      hooks: pack.hooks
    },
    mystery: {
      id: mystery.id,
      title: mystery.title,
      hook: mystery.hook
    }
  };
}
