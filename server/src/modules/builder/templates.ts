/**
 * Story lists, hooks and Quick Video wording carried over from the V2 prototype (storyMap, quickNarration,
 * buildQuickScript) so approved behaviour is preserved. Nothing here states a fact about a client: every factual
 * sentence in a video comes from the client's own website or from the owner.
 */
export const STORIES: Record<string, string[]> = {
  senior_care: ['A Day in the Life', 'Facility Overview', 'Lifestyle & Activities', 'Dining Experience', 'Family’s Search for Care', 'Assisted Living Story', 'Memory Care Story', 'Facility Tour', 'Meet the Care Team', 'Why Choose Us', 'Testimonial Story'],
  dental: ['New Patient Experience', 'From Toothache to Relief', 'Practice Overview', 'Office Tour', 'Meet the Dentist', 'Cosmetic Smile Story', 'Procedure Explainer', 'Why Choose Us', 'FAQ Video'],
  attorneys: ['Client Journey', 'Practice Overview', 'What Happens After You Call', 'Meet the Attorney', 'Practice Area Spotlight', 'Problem to Solution', 'Why Choose Us', 'Legal FAQ'],
  other: ['Customer Journey', 'Business Overview', 'Why Choose Us', 'Services Spotlight', 'Location Tour', 'Meet the Team', 'Problem to Solution', 'FAQ Video'],
};
export const TONES = ['Warm & Emotional', 'Professional', 'Friendly', 'Educational', 'Energetic', 'Premium / Cinematic'];
export const PLATFORMS = ['Cinema Studios', 'HeyGen', 'ToonBee', 'Universal / Not Sure'];

/** Hooks are questions/invitations, never claims about the client. */
export const HOOKS: Record<string, { socialA: string; socialB: string; cta: string }> = {
  senior_care: { socialA: 'What would make every day feel more like home?', socialB: 'Choosing a community for someone you love? Here is what matters.', cta: 'Schedule a personal visit today.' },
  dental: { socialA: 'Looking for a dentist who makes you feel at ease?', socialB: 'Choosing a new dentist? Here is what to look for.', cta: 'Book your visit today.' },
  attorneys: { socialA: 'Facing a legal problem and not sure where to start?', socialB: 'Choosing an attorney? Here is what should matter to you.', cta: 'Call today to talk about your situation.' },
  other: { socialA: 'Looking for someone you can trust to get it done right?', socialB: 'Choosing who to call? Here is what to look for.', cta: 'Get in touch today.' },
};

export const QUICK_PURPOSES = ['Thank You After Service', 'Follow-Up / Check-In', 'Review Request', 'Referral Request', 'Promotion', 'Announcement', 'Seasonal', 'Email Video'] as const;
export const QUICK_DELIVERY = ['Email', 'Text / SMS Link', 'Website / Social'] as const;

export function purposeDirection(purpose: string, market: string) {
  if (purpose === 'Thank You After Service') return `Post-service thank-you courtesy for a ${market} business. Appreciation first, warm and personal, no hard sell.`;
  if (purpose === 'Follow-Up / Check-In') return 'Friendly post-service check-in. Ask how things are going and reinforce availability to help.';
  if (purpose === 'Review Request') return 'Thank the customer first, then politely invite an honest review without pressure or incentives.';
  if (purpose === 'Referral Request') return 'Thank the customer first, then gently mention that referrals are appreciated, without pressure.';
  if (purpose === 'Announcement') return 'Short customer announcement with one clear update and one simple next step.';
  if (purpose === 'Seasonal') return 'Warm seasonal message appropriate for the client and audience, with a light optional call to action.';
  if (purpose === 'Email Video') return 'Standalone email video: concise, email-friendly, and designed to communicate one clear message without requiring the full Standard package.';
  return 'Short promotional follow-up with one clear benefit and one simple call to action.';
}

/** Ported from prototype V2.10.80–V2.10.87: natural speaking-length targets per duration. */
export function quickNarration(purpose: string, client: string, customer: string, service: string, provider: string, message: string, secs = 15, promotionDetails = '') {
  const hello = customer ? `Hi ${customer}, ` : '';
  const from = provider ? ` from ${provider}` : '';
  const serviceText = service ? ` for your ${service}` : '';
  const extra = message ? ` ${message}` : '';
  let base = '';
  if (purpose === 'Thank You After Service') base = `${hello}thank you for choosing ${client}${serviceText}. We truly appreciate the opportunity to serve you${from}.${extra} If you need anything, we're here to help.`;
  else if (purpose === 'Follow-Up / Check-In') base = `${hello}this is a quick check-in from ${client}${from}${serviceText}. We hope everything is going well.${extra} If you have any questions or need anything, please reach out.`;
  else if (purpose === 'Review Request') base = `${hello}thank you for choosing ${client}${serviceText}. We appreciate your trust.${extra} If you have a moment, we'd be grateful if you shared an honest review of your experience.`;
  else if (purpose === 'Referral Request') base = `${hello}thank you for choosing ${client}${serviceText}. We truly appreciate your trust.${extra} If someone you know could use our help, referrals are always appreciated.`;
  else if (purpose === 'Announcement') base = `${hello}here is a quick update from ${client}.${extra} We wanted to make sure you heard the news directly from us. If you have questions or would like more information, please contact our team.`;
  else if (purpose === 'Seasonal') base = `${hello}everyone at ${client} sends warm seasonal wishes to you.${extra} We appreciate staying connected and hope the season brings you comfort, happiness, and time with the people who matter most.`;
  else if (purpose === 'Email Video') base = `${hello}this is a quick message from ${client}.${extra} We wanted to make it easy to connect with you by email. If you have questions or would like to take the next step, simply reply or contact our team.`;
  else {
    const offer = (promotionDetails || '').trim();
    base = `${hello}we wanted to share something special from ${client}.${extra} ${offer} If this sounds helpful, please contact us to learn more or take the next step.`;
  }
  const targetMap: Record<number, number> = { 15: 27, 30: 60, 60: 120, 90: 178, 120: 235 };
  const targetWords = targetMap[secs] || Math.max(27, Math.round(secs * 2.0));
  const additions = [
    `At ${client}, our goal is to make every interaction feel personal, clear, and comfortable.`,
    `We value the confidence you placed in us and want you to know that our team is available whenever questions come up.`,
    `Your experience matters to us, and we appreciate the chance to continue earning your trust.`,
    `We believe good service continues after the immediate work is finished, and we want you to feel comfortable contacting us whenever something comes to mind.`,
    `Our team appreciates the opportunity to get to know the people we serve and to provide the kind of thoughtful attention we would want for our own families.`,
    `Clear communication is important to us, so if there is anything you would like explained, reviewed, or followed up on, please let us know.`,
    `We hope your experience with ${client} left you feeling heard, respected, and confident in the service you received.`,
    `The relationship does not have to end when the appointment or service is complete; we are still here as a resource whenever you need us.`,
    `If a question comes up later, even a small one, we would much rather hear from you than have you wonder what to do next.`,
    `Our goal is to make it easy to stay in touch and to make every future interaction just as welcoming as the first one.`,
    `We are grateful for the trust our customers place in us, because that trust is something we work to earn with every conversation and every service.`,
    `Your feedback and your experience help us continue improving the way we care for and communicate with the people we serve.`,
    `Please keep our contact information handy, and don't hesitate to reach out whenever we can be of assistance.`,
    `Whether you have a follow-up question, need additional help, or simply want to check something with us, our team will be glad to hear from you.`,
    `We appreciate being given the opportunity to serve you and hope you will continue to think of ${client} whenever we can be helpful.`,
    `Thank you again for allowing ${client} to be of service. We look forward to staying connected with you.`,
  ];
  let out = base.replace(/\s+/g, ' ').trim();
  let i = 0;
  if (purpose === 'Promotion' && (promotionDetails || '').trim()) {
    const offer = promotionDetails.trim();
    const promo = [
      `The benefit is simple: ${offer} This gives you an easy reason to take the next step while the opportunity is available.`,
      `If you have been considering this, the offer is designed to make getting started easier and more worthwhile.`,
      `It is a practical way to learn more, see what ${client} can provide, and decide whether it is the right fit for you.`,
      `There is no need to make the decision complicated. Start with the offer, ask any questions you have, and let our team explain the next step clearly.`,
      `We want you to understand exactly what is included, why it may be useful, and how to take advantage of it.`,
      `If the timing is right for you, contact ${client} and mention this offer so our team can help you get started.`,
      `We will be glad to answer questions, explain the details, and help you decide what comes next.`,
      `The goal is to give you a clear benefit and a simple next step without pressure.`,
      `To learn more or take advantage of the promotion, reach out to ${client} and ask about the offer you just heard about.`,
      `We look forward to helping you make the most of this opportunity.`,
    ];
    while (out.split(/\s+/).length < targetWords && i < promo.length) out += ' ' + promo[i++];
  } else {
    while (out.split(/\s+/).length < targetWords && i < additions.length) out += ' ' + additions[i++];
  }
  const words = out.split(/\s+/);
  if (words.length > targetWords + 8) {
    const sentences = out.match(/[^.!?]+[.!?]+/g) || [out];
    let fitted = '';
    for (const sentence of sentences) {
      const candidate = (fitted + ' ' + sentence.trim()).trim();
      if (candidate.split(/\s+/).length > targetWords + 5) break;
      fitted = candidate;
    }
    if (fitted) out = fitted;
  }
  return out.trim();
}

export function quickScript(o: { purpose: string; delivery: string; secs: number; client: string; market: string; tone: string; customer: string; service: string; provider: string; message: string; promotionDetails: string; narration: string }) {
  const avatar = o.provider || o.client;
  const sceneCount = o.secs <= 15 ? 3 : o.secs <= 30 ? 4 : o.secs <= 60 ? 6 : o.secs <= 90 ? 8 : 10;
  const parts: string[] = [];
  for (let i = 0; i < sceneCount; i++) {
    const start = Math.floor(i * o.secs / sceneCount), end = i === sceneCount - 1 ? o.secs : Math.floor((i + 1) * o.secs / sceneCount);
    const visual = i === 0 ? `Open with ${avatar} on camera as the presenter/avatar, framed warmly and professionally.`
      : i === sceneCount - 1 ? `Return to ${avatar} or a clean ${o.client} closing visual. Keep the ending personal and uncluttered.`
        : 'Use approved client imagery that supports the service and customer relationship; no hard-sell graphics.';
    parts.push(`Scene ${i + 1} — ${start}-${end} sec\nScene visualization:\n${visual}`);
  }
  return `BRITTVIDEO QUICK VIDEO — ${o.purpose.toUpperCase()}\n\nCLIENT: ${o.client}\nMARKET: ${o.market}\nDELIVERY: ${o.delivery}\nTARGET LENGTH: ${o.secs} seconds\nTONE: ${o.tone}\nPURPOSE: ${purposeDirection(o.purpose, o.market)}\n${o.purpose === 'Email Video' ? 'VIDEO TYPE: STANDALONE EMAIL VIDEO\nFORMAT: 16:9 EMAIL-FRIENDLY\n' : ''}\nPERSONALIZATION\nCustomer: ${o.customer || 'Not specified'}\nService: ${o.service || 'Not specified'}\nProvider / Employee: ${o.provider || 'Not specified'}\nSpecial Message: ${o.message || 'None'}\nPromotion / Offer Details: ${o.purpose === 'Promotion' ? (o.promotionDetails || 'Not specified') : 'Not applicable'}\n\nFINAL NARRATION — EDIT AS NEEDED\n“${o.narration}”\n\nPRODUCTION PLAN\n${parts.join('\n\n')}`;
}
