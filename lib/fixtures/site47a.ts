/**
 * The Site 47-A golden fixture — the demo's scripted deliberation as typed data.
 * CLAUDE.md §12: test the live-stream path by replaying these events before
 * touching real LLM runs. Source of truth: public/demo.html `events` array.
 */

export interface FixtureAgent {
  key: string;
  initials: string;
  name: string;
  role: string;
  blurb?: string;
  tag?: string;
  adv?: boolean;
  /** lead discipline cluster this agent belongs to (for graph layout) */
  cluster?: string;
  /** label shown on the canvas when speaking */
  label?: string;
  /** resident ring index for resident agents */
  res?: number;
}

export interface FixtureEvent {
  /** virtual time (seconds) at which the event fires */
  t: number;
  /** p = lead post, c = reply/comment, b = burst rollup */
  k: "p" | "c" | "b";
  /** post number for lead posts */
  n?: number;
  /** agent key */
  a?: string;
  /** reply target agent key */
  to?: string;
  /** position change */
  flip?: boolean;
  x: string;
}

export const SITE47A = {
  id: "site-47a-replay",
  title: "Technical site assessment — Site 47-A, Mesa, AZ",
  question:
    "Is ±212 acres at Signal Butte Rd & Pecos Rd, Mesa, AZ suitable for a 300MW data center campus?",
  meta: "±212 ac · Signal Butte & Pecos · $385K/acre ask · go / no-go",
  expertCount: 48,
  disciplineCount: 8,
  residentCount: 400,
  simDays: 14,
  totalPosts: 611,
  totalT: 127,
  dissents: 3,
  leads: ["DC", "RM", "JB", "AS", "KO", "MG", "TV", "ER"],
};

export const AGENTS: Record<string, FixtureAgent> = {
  DC: { key: "DC", initials: "DC", name: "Derek C.", role: "hyperscaler site-selection lead", blurb: "Sited 11 campuses · optimizes for cluster adjacency", tag: "SITE SELECTION" },
  RM: { key: "RM", initials: "RM", name: "Rosa M.", role: "grid interconnection planner", blurb: "22 yrs SRP transmission · skeptical of broker timelines", tag: "POWER" },
  JB: { key: "JB", initials: "JB", name: "Jonah B.", role: "powered-land investor", blurb: "Structures options against interconnect risk", tag: "CAPITAL" },
  AS: { key: "AS", initials: "AS", name: "Aliyah S.", role: "water resources engineer", blurb: "AZ assured-water-supply and reclaimed systems", tag: "WATER" },
  KO: { key: "KO", initials: "KO", name: "Ken O.", role: "fiber network architect", blurb: "Long-haul routes and latency budgets, Phoenix metro", tag: "FIBER" },
  MG: { key: "MG", initials: "MG", name: "Marisol G.", role: "city planner, econ development", blurb: "Mesa entitlement process · reads council appetite", tag: "ENTITLEMENT" },
  TV: { key: "TV", initials: "TV", name: "Tom V.", role: "industrial land broker", blurb: "East Valley comps · knows every owner on the corridor", tag: "LAND" },
  ER: { key: "ER", initials: "ER", name: "Elena R.", role: "community advocate", blurb: "Seeded adversarial · organized past noise opposition", tag: "ADVERSARIAL SEED", adv: true },
  NF: { key: "NF", initials: "NF", name: "Nadia F.", role: "grid market analyst", cluster: "RM", label: "NADIA · GRID" },
  PH: { key: "PH", initials: "PH", name: "Paul H.", role: "water systems engineer", cluster: "AS", label: "PAUL · WATER" },
  GL: { key: "GL", initials: "GL", name: "Grace L.", role: "fiber route planner", cluster: "KO", label: "GRACE · FIBER" },
  OD: { key: "OD", initials: "OD", name: "Omar D.", role: "infra capital analyst", cluster: "JB", label: "OMAR · CAPITAL" },
  YT: { key: "YT", initials: "YT", name: "Yuki T.", role: "land-use counsel", cluster: "MG", label: "YUKI · COUNSEL" },
  HS: { key: "HS", initials: "HS", name: "Hank S.", role: "industrial land broker", cluster: "TV", label: "HANK · LAND" },
  R2: { key: "R2", initials: "R·", name: "Resident agent #204", role: "Mesa 85212 · ACS-seeded", label: "RES #204", res: 12 },
  RS1: { key: "RS1", initials: "R·", name: "Resident agent #117", role: "Mesa 85212 · ACS-seeded", label: "RES #117", res: 40 },
  RS2: { key: "RS2", initials: "R·", name: "Resident agent #302", role: "Queen Creek 85142 · ACS-seeded", label: "RES #302", res: 70 },
  RS3: { key: "RS3", initials: "R·", name: "Resident agent #58", role: "Mesa 85212 · ACS-seeded", label: "RES #58", res: 95 },
};

export const EVENTS: FixtureEvent[] = [
  { t: 2.5, k: "p", n: 1, a: "DC", x: "Screened the fundamentals overnight. 212 contiguous acres, single owner, flat, no floodway on the FIRM panel, and we're one interchange from the Elliot Road corridor cluster — established operators within a 15-minute drive means labor, vendors, and permitting precedent already exist. At $385K/acre this prices like unpowered dirt. But the entire thesis lives or dies on SRP. Rosa — what does the large-load queue actually look like right now, not what the broker OM claims?" },
  { t: 5, k: "c", a: "GL", to: "DC", x: "Pecos corridor is lit at 432-count; two providers quote a 90-day turn-up. Whatever kills this deal, it won't be latency." },
  { t: 7.5, k: "c", a: "OD", to: "DC", x: "At $385K/acre the ask is $81.6M all-in. Running the option math now." },
  { t: 9.5, k: "c", a: "HS", to: "DC", x: "Single owner, no ag lease encumbrance, clean title per the ALTA. Rare on this corridor." },
  { t: 11, k: "b", x: "+22 POSTS · GEOTECH + FLOOD SUBTHREADS" },
  { t: 13, k: "c", a: "KO", to: "DC", x: "Confirming Grace's read from the route maps — sub-1ms to the Elliot Road cluster on either provider. Fiber is a non-issue." },
  { t: 15.5, k: "c", a: "DC", to: "KO", x: "Good. Latency was my only fiber question." },
  { t: 17.5, k: "c", a: "RS1", to: "DC", x: "Is this the parcel behind the Eastmark HOA? Watching this one closely." },
  { t: 19.5, k: "b", x: "+31 POSTS · RESIDENT FORUM · ZIPS 85212 / 85142" },
  { t: 21, k: "c", a: "NF", to: "RM", x: "Pulling SRP's public queue filings before Rosa weighs in. Refresh drops next month — worth timing the LOI to it." },
  { t: 23, k: "p", n: 2, a: "RM", to: "DC", x: "The OM is fiction. Nearest 230kV circuit is 1.8 miles north with no spare substation capacity — you're funding a new receiving station plus a line extension, and SRP's large-load study queue puts full 300MW energization at 2030–2031, realistically. I can see a path to 40–60MW of bridge capacity by late 2027 off the distribution system if the load letter is phased honestly. And note: at least two speculative positions sit ahead of this parcel in the queue. If they wash out, everything moves left a year — but you can't underwrite on that." },
  { t: 27, k: "c", a: "OD", to: "RM", x: "If energization is 2030–31, carry cost eats ~9% of the spread. Still pencils." },
  { t: 29.5, k: "c", a: "NF", to: "RM", x: "Both spec positions ahead in the queue confirmed — neither has land control. Wash-out is plausible, not bankable." },
  { t: 32, k: "c", a: "PH", to: "RM", x: "Flagging early: dry-cooled design raises power draw ~3%. Rosa's number should absorb it." },
  { t: 34, k: "b", x: "+18 POSTS · INTERCONNECT COST MODELS" },
  { t: 36, k: "c", a: "DC", to: "RM", x: "That's the number that matters. Is the 1.8-mile extension overhead or underground? The cost delta is 4×." },
  { t: 39.5, k: "c", a: "HS", to: "RM", x: "Gas easement holder on that run is Kinder Morgan — crossing consent is routine, 60–90 days." },
  { t: 43, k: "c", a: "RM", to: "DC", x: "Overhead is viable for the whole run — no river crossing, one gas easement to clear. Call it $9–14M and 30 months if SRP prioritizes it." },
  { t: 46.5, k: "c", a: "OD", to: "RM", x: "$14M line extension is $47/kW on 300MW. Noise, not signal." },
  { t: 49, k: "b", x: "+26 POSTS · BRIDGE POWER SCENARIOS" },
  { t: 51.5, k: "c", a: "YT", to: "RM", x: "Reminder: the line extension itself needs a CUP if poles exceed 65 feet. Fold it into the main application." },
  { t: 54, k: "p", n: 3, a: "JB", to: "RM", x: "Rosa's timeline is the deal, not the dealbreaker. Comparable powered land in the East Valley trades at $1.2–1.6M/acre; this asks $385K unpowered. That spread IS the interconnect risk, so don't buy it — option it: 5% down, milestone payments tied to SRP's phase-two study results, close only on an executed load letter. On the 2027–2029 gap: peers are bridging with behind-the-meter gas turbines, but Maricopa is an ozone nonattainment area, so air permitting for 60MW of on-site generation is its own 18-month fight. Price that in or don't count the bridge." },
  { t: 57.5, k: "c", a: "OD", to: "JB", x: "Structured that way, $4.1M is at risk against a $60M+ spread. Asymmetric. I'd sign it." },
  { t: 60.5, k: "c", a: "PH", to: "JB", x: "On the air permit: the Chandler peaker took 22 months in nonattainment. 18 is optimistic." },
  { t: 63, k: "b", x: "+34 POSTS · COMPS + OPTION STRUCTURES" },
  { t: 65, k: "c", a: "RS2", to: "ER", x: "We moved out here for quiet. Honest question — what does a load bank test actually sound like?" },
  { t: 67, k: "c", a: "TV", to: "JB", x: "Comps check: three East Valley powered parcels traded $1.2–1.6M/acre inside 18 months. Unpowered at $385K with a real interconnect path is the cheapest optionality on the corridor." },
  { t: 70, k: "c", a: "HS", to: "TV", x: "Confirmed — and the seller's broker is already floating 'multiple offers.' Standard theater; the queue position is the real clock." },
  { t: 73, k: "b", x: "+29 POSTS · EAST VALLEY LAND DESK" },
  { t: 76, k: "p", n: 4, a: "AS", x: "Before anyone models evaporative cooling: don't. Commit to air-cooled design in the first public document you file. Mesa's council took real heat over earlier data center water deals, and with Colorado River shortage tiers in the news, any seven-figure-GPD ask is politically radioactive even where the assured-water-supply math technically works. There's a reclaimed line within a mile for non-potable makeup and landscape — use it, and say so loudly in the application." },
  { t: 79.5, k: "c", a: "PH", to: "AS", x: "Reclaimed main on Ray Rd is 16-inch — capacity is fine for makeup and landscape. It's a one-mile lateral." },
  { t: 82.5, k: "c", a: "YT", to: "AS", x: "An air-cooled commitment in filing #1 also short-circuits the water portfolio review. Do it for the schedule alone." },
  { t: 85, k: "b", x: "+41 POSTS · WATER STRATEGY THREAD" },
  { t: 88, k: "p", n: 5, a: "ER", x: "I'll tell you how this goes wrong, because my neighborhood lived it. When the last operator started generator load-bank testing near us, nobody had warned residents what dozens of diesel gensets sound like at 6 a.m. Complaints became organized opposition within a month. If you're serious: 600-foot setbacks from the residential edge, sound walls in the first site plan — not as a concession later — published testing windows, and show up to the HOAs before the rezoning notice does. Otherwise you're the reason the moratorium passes." },
  { t: 91.5, k: "c", a: "RS3", to: "ER", x: "The Elliot Rd build-out, the worst part was construction traffic at school hours. Route trucks off Signal Butte or you'll hear from all of us." },
  { t: 94.5, k: "c", a: "MG", to: "ER", x: "Elena — send me the mitigation list as you'd write it. I want it verbatim in the pre-application packet." },
  { t: 97.5, k: "c", a: "R2", to: "ER", x: "What broke trust wasn't even the noise — it was that nobody told us the testing schedule. Publish it, and answer the phone when we call." },
  { t: 100, k: "b", x: "+37 POSTS · COMMUNITY FORUM · 214 RESIDENT AGENTS ACTIVE" },
  { t: 102.5, k: "c", a: "DC", to: "ER", x: "Noted on setbacks. Adding the 600-ft residential buffer to the concept plan tonight." },
  { t: 105, k: "p", n: 6, a: "MG", x: "Zoning is workable — the parcel carries Light Industrial and data centers remain permitted — but council appetite has shifted since 2024 and design review will be aggressive on massing and noise. The state's data center TPT exemption still pencils on equipment. My honest read: pair the application with a community benefits agreement and Elena's mitigation list upfront and this approves in 9–12 months. Arrive without it and you're the test case for tighter rules." },
  { t: 108.5, k: "c", a: "YT", to: "MG", x: "Agree on 9–12 months with a CBA. Without one, expect a continuance at the first hearing — that's the pattern since 2024." },
  { t: 111, k: "c", a: "OD", to: "MG", x: "A CBA at $2–3M/yr is ~40bps on the project. Buy the goodwill." },
  { t: 113.5, k: "b", x: "+28 POSTS · ENTITLEMENT TIMELINE MODELS" },
  { t: 117, k: "p", n: 7, a: "DC", flip: true, x: "Updating from go to conditional go. The fundamentals I opened with hold, but Rosa's queue reality means we should not close on fee title now. Option it with interconnect contingencies per Jonah's structure, file dry-cooled from day one per Aliyah, and fund the community package before the first hearing. If the phase-two study comes back clean, this is a 2031 campus bought at 2026 dirt prices." },
  { t: 120.5, k: "c", a: "JB", to: "DC", x: "Locking the option structure with counsel this week." },
  { t: 122.5, k: "c", a: "RM", to: "DC", x: "I'll draft the phased load letter for the SRP pre-application." },
];
