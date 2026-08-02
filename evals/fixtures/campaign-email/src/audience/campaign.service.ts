export const campaignEmailTemplate = "campaign-message-responsive";

export function renderCampaignEmail(message: string) {
  return { template: campaignEmailTemplate, message };
}
