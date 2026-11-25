// Bundled base-rate pack (US-first). Every number carries a grade and a source:
//   A = official table (Census, BLS, CDC) · B = derived from an official table or reputable source
//   C = rough judgement, no table found yet (shown amber in the UI, widest range)
// Fractions are of the whole reference population.
// Anything not in this pack is looked up live (cloud + Google Search grounding), one
// generic attribute per request.

/// US adults (18+): ~77.5% of ~340M. Every US fraction below is "share of adults".
public let US_ADULTS: Double = 263_000_000

public struct RegionEntry: Sendable {
    public let region: Region
    public let aliases: JSRegex

    public init(region: Region, aliases: JSRegex) {
        self.region = region
        self.aliases = aliases
    }
}

public struct PackEntry: Sendable {
    public let rate: BaseRate
    public let aliases: JSRegex

    public init(rate: BaseRate, aliases: JSRegex) {
        self.rate = rate
        self.aliases = aliases
    }
}

public struct Affinity: Sendable {
    public let a: String
    public let b: String
    public let lift: Double
    public let grade: Grade
    public let source: String
    public let url: String?

    public init(a: String, b: String, lift: Double, grade: Grade, source: String, url: String? = nil) {
        self.a = a
        self.b = b
        self.lift = lift
        self.grade = grade
        self.source = source
        self.url = url
    }
}

public let REGIONS: [RegionEntry] = [
    RegionEntry(
        region: Region(
            key: "us:oh:franklin", label: "Franklin County, Ohio (Columbus)", population: 1_323_807, adultShare: 0.775, grade: .A,
            source: "US Census 2020: 1,323,807 people; 22.5% under 18 (QuickFacts)", url: "https://www.census.gov/quickfacts/franklincountyohio"
        ),
        aliases: JSRegex(#"\b(columbus|franklin county|clintonville|german village|short north|olentangy)\b"#, caseInsensitive: true)
    ),
    RegionEntry(
        region: Region(
            key: "us:oh", label: "Ohio", population: 11_799_448, adultShare: 0.78, grade: .A,
            source: "US Census 2020", url: "https://www.census.gov/quickfacts/OH"
        ),
        aliases: JSRegex(#"\b(ohio|buckeye state|cleveland|cincinnati|dayton|toledo)\b"#, caseInsensitive: true)
    ),
    RegionEntry(
        region: Region(
            key: "us", label: "United States", population: 331_449_281, adultShare: 0.78, grade: .A,
            source: "US Census 2020", url: "https://www.census.gov/library/stories/state-by-state.html"
        ),
        aliases: JSRegex(#"\b(usa|united states|america|american)\b"#, caseInsensitive: true)
    ),
    RegionEntry(
        region: Region(
            key: "in:ka:bengaluru", label: "Bengaluru Urban district", population: 9_621_551, adultShare: 0.72, grade: .C,
            source: "Census of India 2011: 15 years old and the city has grown a lot since, so graded C (wide range)", url: "https://en.wikipedia.org/wiki/Bangalore_Urban_district"
        ),
        aliases: JSRegex(#"\b(bengaluru|bangalore|koramangala|indiranagar|whitefield|hsr layout)\b"#, caseInsensitive: true)
    ),
]

public let DEFAULT_REGION: Region = REGIONS.first(where: { $0.region.key == "us" })!.region

public let PACK: [PackEntry] = [
    // ---------- occupation ----------
    PackEntry(
        rate: BaseRate(
            key: "occupation:nurse", label: "registered nurses", cat: "occupation",
            low: 3_465_400 / US_ADULTS * 0.95, high: 3_465_400 / US_ADULTS * 1.05, grade: .A,
            source: "BLS Occupational Outlook: 3,465,400 RN jobs (2025) ÷ US adults",
            url: "https://www.bls.gov/ooh/healthcare/registered-nurses.htm", origin: .bundled
        ),
        aliases: JSRegex(#"\bnurs(e|es|ing)\b|\brn\b"#, caseInsensitive: true)
    ),
    PackEntry(
        rate: BaseRate(
            key: "occupation:icu_nurse", label: "ICU / critical-care nurses", cat: "occupation",
            low: 0.0016, high: 0.0032, grade: .C,
            source: "Assumes 12–25% of RNs work in critical care (no BLS split published)", origin: .bundled, within: "occupation:nurse"
        ),
        aliases: JSRegex(#"\b(icu|critical care|intensive care|micu|sicu)\b"#, caseInsensitive: true)
    ),
    PackEntry(
        rate: BaseRate(
            key: "occupation:software_engineer", label: "software developers", cat: "occupation",
            low: 0.0062, high: 0.0070, grade: .A,
            source: "BLS: ~1.7M software developers (2024) ÷ US adults",
            url: "https://www.bls.gov/ooh/computer-and-information-technology/software-developers.htm", origin: .bundled
        ),
        aliases: JSRegex(#"\b(software (engineer|developer)|sre|programmer|backend|frontend)\b"#, caseInsensitive: true)
    ),
    PackEntry(
        rate: BaseRate(
            key: "occupation:teacher", label: "K-12 teachers", cat: "occupation",
            low: 0.0135, high: 0.0155, grade: .B,
            source: "NCES: ~3.8M public + private K-12 teachers",
            url: "https://nces.ed.gov/fastfacts/display.asp?id=28", origin: .bundled
        ),
        aliases: JSRegex(#"\b(teacher|teaching|my students|band director)\b"#, caseInsensitive: true)
    ),
    // ---------- gender / family ----------
    PackEntry(
        rate: BaseRate(
            key: "gender:female", label: "women", cat: "gender",
            low: 0.505, high: 0.515, grade: .A,
            source: "Census QuickFacts, Franklin County: 51.3% female",
            url: "https://www.census.gov/quickfacts/franklincountyohio", origin: .bundled
        ),
        aliases: JSRegex(#"\b(female|woman|women|mom|mum|mother|she|wife)\b"#, caseInsensitive: true)
    ),
    PackEntry(
        rate: BaseRate(
            key: "family:single_mother", label: "single mothers with kids at home", cat: "family",
            low: 7_666_000 / US_ADULTS * 0.95, high: 7_666_000 / US_ADULTS * 1.05, grade: .A,
            source: "Census Families & Living Arrangements: 7.67M one-parent families with mother (2025)",
            url: "https://fred.stlouisfed.org/series/OPFWCUMO", origin: .bundled
        ),
        aliases: JSRegex(#"\bsingle (mom|mum|mother|parent)\b"#, caseInsensitive: true)
    ),
    PackEntry(
        rate: BaseRate(
            key: "family:twins", label: "parents of twins under 18", cat: "family",
            low: 0.0038, high: 0.0075, grade: .B,
            source: "CDC NCHS: twin birth rate 30.1 per 1,000 births (2024) → ~55k twin sets/yr × 18 yrs × 1–2 parents each ÷ US adults",
            url: "https://www.cdc.gov/nchs/data/hestat/hestat117.htm", origin: .bundled
        ),
        aliases: JSRegex(#"\btwins?\b"#, caseInsensitive: true)
    ),
    PackEntry(
        rate: BaseRate(
            key: "family:kindergartner", label: "parents of a kindergartner this year", cat: "family",
            low: 0.014, high: 0.028, grade: .C,
            source: "Rough: NCES ~3.7M kindergarten enrollments × 1–2 parents each ÷ US adults", origin: .bundled
        ),
        aliases: JSRegex(#"\bkindergarten|pre-?k\b"#, caseInsensitive: true)
    ),
    PackEntry(
        rate: BaseRate(
            key: "relationship:divorced", label: "divorced or separated", cat: "relationship",
            low: 0.07, high: 0.11, grade: .C,
            source: "Rough: ACS shows roughly 1 in 10 adults currently divorced or separated", origin: .bundled
        ),
        aliases: JSRegex(#"\b(divorc|separated|my ex\b|left (him|her|my (husband|wife)))"#, caseInsensitive: true)
    ),
    // ---------- age ----------
    PackEntry(
        rate: BaseRate(
            key: "age:single_year", label: "people of one specific age", cat: "age",
            low: 0.016, high: 0.018, grade: .B,
            source: "Census age pyramid: each single-year cohort aged 25–45 ≈1.6–1.8% of adults", origin: .bundled
        ),
        aliases: JSRegex(#"\b(turned \d+|\d{2} years old|born (19|20)\d\d)\b"#, caseInsensitive: true)
    ),
    // ---------- possessions / hobbies / education / events ----------
    PackEntry(
        rate: BaseRate(
            key: "hobby:half_marathon", label: "half-marathon finishers", cat: "rare_hobby",
            low: 0.0035, high: 0.0075, grade: .C,
            source: "Running USA: 1.85M US half-marathon finishes (2012; finishes, not people) ÷ US adults",
            url: "https://www.runningusa.org/", origin: .bundled
        ),
        aliases: JSRegex(#"\bhalf[- ]?marathon"#, caseInsensitive: true)
    ),
    PackEntry(
        rate: BaseRate(
            key: "vehicle:subaru", label: "Subaru owners", cat: "vehicle",
            low: 0.02, high: 0.035, grade: .C,
            source: "Rough: Subaru ≈4% of US new-vehicle sales", origin: .bundled
        ),
        aliases: JSRegex(#"\bsubaru|outback|forester|crosstrek\b"#, caseInsensitive: true)
    ),
    PackEntry(
        rate: BaseRate(
            key: "education:bsn", label: "nurses with a BSN", cat: "education",
            low: 0.0075, high: 0.0095, grade: .C,
            source: "Rough: ~65% of RNs hold a BSN or higher", origin: .bundled, within: "occupation:nurse"
        ),
        aliases: JSRegex(#"\bbsn\b|bachelor'?s? (of|in) (science in )?nursing"#, caseInsensitive: true)
    ),
    PackEntry(
        rate: BaseRate(
            key: "work:night_shift", label: "night-shift workers", cat: "work_location",
            low: 0.04, high: 0.07, grade: .C,
            source: "Rough: BLS shift-work surveys put regular night shifts at a few % of workers", origin: .bundled
        ),
        aliases: JSRegex(#"\bnight[- ]?shift|nocturnist|nights\b"#, caseInsensitive: true)
    ),
    PackEntry(
        rate: BaseRate(
            key: "event:moved_year", label: "people who moved there in one specific year", cat: "dated_event",
            low: 0.03, high: 0.06, grade: .C,
            source: "Rough: annual in-county movers", origin: .bundled
        ),
        aliases: JSRegex(#"\bmoved (here|to|in)\b"#, caseInsensitive: true)
    ),
    PackEntry(
        rate: BaseRate(
            key: "pet:cat", label: "cat owners", cat: "pet",
            low: 0.2, high: 0.3, grade: .B,
            source: "APPA: ~1 in 4 US households own a cat", origin: .bundled
        ),
        aliases: JSRegex(#"\bcats?\b"#, caseInsensitive: true)
    ),
    PackEntry(
        rate: BaseRate(
            key: "pet:one_eyed_cat", label: "owners of a one-eyed cat", cat: "pet",
            low: 0.0005, high: 0.005, grade: .C,
            source: "Rough guess: a distinctive pet is a strong marker", origin: .bundled, within: "pet:cat"
        ),
        aliases: JSRegex(#"\bone[- ]eyed\b"#, caseInsensitive: true)
    ),
    PackEntry(
        rate: BaseRate(
            key: "event:race_medical_volunteer", label: "medical volunteers at one specific race", cat: "dated_event",
            low: 0.00005, high: 0.0003, grade: .C,
            source: "Rough: a big-city marathon recruits a few hundred medical volunteers", origin: .bundled
        ),
        aliases: JSRegex(#"\bmedical tent|medical volunteer|aid station\b"#, caseInsensitive: true)
    ),
]

/// Never sent to the cloud, not even as a single generic word.
public let LOCAL_ONLY_CATS: Set<String> = ["health", "religion_community"]

public func matchPack(_ cat: String, _ value: String, _ quote: String) -> PackEntry? {
    let text = "\(value) \(quote)"
    // Lowest `high` wins; ties keep the earliest entry in the pack (matches the stable JS sort).
    var best: PackEntry?
    for p in PACK where p.aliases.test(text) && (p.rate.cat == cat || compatible(cat, p.rate.cat)) {
        if best == nil || p.rate.high < best!.rate.high {
            best = p
        }
    }
    return best
}

private func compatible(_ a: String, _ b: String) -> Bool {
    let groups: [[String]] = [
        ["occupation", "employer_type", "work_location", "education"],
        // Life events ("since the divorce", "the twins were born") often come back as dated_event.
        ["family", "relationship", "gender", "dated_event"],
        ["rare_hobby", "dated_event"],
    ]
    return groups.contains { $0.contains(a) && $0.contains(b) }
}

public func matchRegion(_ text: String) -> Region? {
    REGIONS.first(where: { $0.aliases.test(text) })?.region
}

/// Overlap table: how much more common B is among people who have A, i.e. P(B|A) / P(B).
/// Independence would make crowds far too small (88% of nurses are women; divorce is much
/// more common among single mothers). Applied symmetrically; the largest lift wins.
public let AFFINITY: [Affinity] = [
    Affinity(a: "occupation:nurse", b: "gender:female", lift: 0.878 / 0.51, grade: .A, source: "Data USA (ACS 2024): 87.8% of RNs are women", url: "https://datausa.io/profile/soc/registered-nurses"),
    Affinity(a: "occupation:icu_nurse", b: "gender:female", lift: 0.878 / 0.51, grade: .A, source: "Data USA (ACS 2024): 87.8% of RNs are women", url: "https://datausa.io/profile/soc/registered-nurses"),
    Affinity(a: "family:single_mother", b: "gender:female", lift: 1 / 0.51, grade: .A, source: "Definitional: every single mother is a woman"),
    Affinity(a: "family:single_mother", b: "relationship:divorced", lift: 3.3, grade: .C, source: "Rough: ~3 in 10 single mothers are divorced vs ~1 in 11 adults"),
    Affinity(a: "occupation:nurse", b: "work:night_shift", lift: 5, grade: .C, source: "Rough: ~1 in 4 hospital RNs work nights vs ~1 in 20 workers"),
    Affinity(a: "occupation:icu_nurse", b: "work:night_shift", lift: 5, grade: .C, source: "Rough: ~1 in 4 hospital RNs work nights vs ~1 in 20 workers"),
    Affinity(a: "family:single_mother", b: "family:kindergartner", lift: 2.5, grade: .C, source: "Rough: single mothers by definition have kids at home"),
    Affinity(a: "family:single_mother", b: "family:twins", lift: 2.5, grade: .C, source: "Rough: single mothers by definition have kids at home"),
    Affinity(a: "family:twins", b: "family:kindergartner", lift: 6, grade: .C, source: "Rough: twins under 18 → ~1 in 6 chance they are in kindergarten this year"),
]

public func liftFor(_ key: String, _ present: [String]) -> (lift: Double, with: String?) {
    var best: (lift: Double, with: String?) = (lift: 1, with: nil)
    for r in AFFINITY {
        let other: String?
        if r.a == key {
            other = r.b
        } else if r.b == key {
            other = r.a
        } else {
            other = nil
        }
        if let other, present.contains(other), r.lift > best.lift {
            best = (lift: r.lift, with: other)
        }
    }
    return best
}
