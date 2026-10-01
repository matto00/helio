export interface PersonaTemplateOption {
  /** Matches the server's template slug (`PersonaTemplates`) and the telemetry rollup slug. */
  slug: string;
  label: string;
  description: string;
}

export const PERSONA_TEMPLATES: readonly PersonaTemplateOption[] = [
  { slug: "streamer", label: "Streamer", description: "Followers, hours and revenue by game" },
  { slug: "founder", label: "Founder", description: "Signups and new MRR by channel" },
  { slug: "ops", label: "Ops", description: "Incidents and uptime by service" },
  { slug: "finance", label: "Finance", description: "Spend by month and category" },
];
