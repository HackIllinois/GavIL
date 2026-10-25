/**
 * Pleas to the judge, by class (W3b). ADVOCACY in extract.ts is a list of phrases; every sweep of
 * it left near rewordings of the same asks behind ("root for us", "help us win", "send us to
 * round two", "tell the other judges about us", "we're counting on you", "a good word to the
 * panel would go a long way"). This adds the classes, so a reworded ask is caught without its
 * phrase being listed:
 *
 *   BACK      a verb of backing someone, with the team as the object ("vouch for us", "speak up
 *             for us", "champion our project", "fight for us")
 *   NETWORK   the judge told to take the team to the other judges or the deliberation ("tell the
 *             other judges about us", "talk us up to the panel", "mention us in deliberations")
 *   PLACE     a verb that moves the team somewhere, and where: the finals, round two, the top
 *             three, the podium, the shortlist, a prize ("send us to round two", "put us at
 *             number one", "mark us down for most creative", "help us win")
 *   COUNT     counting on, needing or hoping for the judge's vote, help, word or favour ("we're
 *             counting on you", "we need your help to win", "a vote from you changes everything",
 *             "a word to the panel would mean a lot", "blessed with your favor")
 *   EASE      leniency, the benefit of the doubt, a thumb on the scale ("go easy on us", "be
 *             generous with your ranking", "boost our score", "tip the scales our way")
 *   HOPE      a hope or a feeling about being picked ("we'd be thrilled to be selected", "let's
 *             hope we crack the shortlist", "we're hoping you like what we built")
 *   ATTEND    asking to be seen, kept in view or not skipped ("make sure the judges see us",
 *             "don't let us slip through", "spare us a moment in your notes")
 *
 * Each class needs the team as the object (or a judge-aimed word beside it) and a destination or
 * a politeness, so ordinary talk about the app survives: "it helps us win back time", "the
 * judges told us to add a fallback", "the app puts us on the map". Folded and lowercased text;
 * bounded repetition; no lookbehind.
 */
import { spokenName } from "./spoken"

/** "win" in its everyday senses (see extract.ts). */
const NOT_EVERYDAY_WIN = String.raw`(?! (?:back|over|against|at|in a|games?|matches|rounds?|(?:every|most|more) (?:games?|matches|rounds?|races?|battles?|time|of|users|customers|people|deals|clients)|people|users|customers|time|hours?|minutes?|money|trust|them|you|the (?:user|game|match|round)))`
const NOT_WIN_OVER = String.raw`(?! (?:the |their |our |your |more |new |some )?(?:trust|hearts?|minds?|loyalty|support|attention|confidence|business|customers?|users?|people|market|race|game|match|battle|war|argument|fight|lottery|raffle|jackpot)\b)`

/** A prize of this event by name: "best social impact", "most creative", "the stripe prize". */
const NAMED = String.raw`(?:(?:best|most) (?:ui(?:/| )?ux|ui|ux|use of [\w-]+|creative|social impact|social|useless|popular|hack|overall|design|impact|innovative)(?! (?:we|i|you|that|to|for|in|on|with|of|can|could|would|will|so|and|angle|part|aspect|side|bit|thing)\b)|the (?:[\w/-]+ ){1,2}(?:prize|award)|(?:the )?[\w/-]+ (?:prize|award))`

/** Where a team wants the judge to put it. */
/** A chart or a list inside the app, not the judge's own: "make the top ten on the app store". */
const NOT_A_RANKING = String.raw`(?! (?:(?:on|in|at|for|among|across) (?:the |our |a |all |every )?(?:[\w'-]+ ){0,3}(?:leaderboards?|benchmarks?|charts?|lists?|app store|play store|results|search|rankings?|downloads|github|hugging face|trending|category|categories|leagues?)|priority|priorities|reason|cause|goal|thing|complaint|request|feature|problem|issue|step|rule|concern|killer|source|question|fan|use case)\b)`
const GOAL = String.raw`(?:(?:the |a |an |your )?(?:finals?|final round|finalists?|semi-?finals?|round (?:2|two|3|three)|(?:next|second|final|third) (?:round|stage|phase|cut)|top (?:\d+|three|five|ten|spots?|picks?|tier|tiers|choices?|places?|positions?)|podium|short ?list|winners?(?:'s)? circle|winners?|first place|1st place|second place|third place|first prize|gold|number one|#1|no\.? ?1|prizes?|awards?|trophy|trophies|medals?|nominations?|nominees?|runner-?ups?|cut|semis|wildcard(?: spot| slot| call)?|(?:the )?top(?= *(?:$|[.,!?;:])| of (?:the|your|this) (?:list|rankings?|standings|leaderboard|pile|class|pack)\b| please\b)|top (?:spot|slot|position|place|rank|tier|placement|ranking|billing|honou?rs)|(?:strong |top |real |serious |clear )?(?:contenders?|front-?runners?|favou?rites?|picks?|standouts?|keepers?))|${NAMED}|win(?:ning)?\b${NOT_EVERYDAY_WIN}${NOT_WIN_OVER})${NOT_A_RANKING}`

/** A judge-aimed noun: the people who decide. */
const JUDGES = String.raw`(?:(?:the |all the |all of the |other |your |our |fellow |rest of the |remaining |organi[sz]ers and |both )*(?:judges?|panel|panelists|jurors?|jury|committee|organi[sz]ers?|sponsors?|decision makers|deliberations?|judging room|judging table))`

/**
 * The judges the team is NOT talking to: "the other judges", the panel, the jury, the committee,
 * the deliberation. A team telling its own judge about its app ("we show the judges a demo of our
 * app") is not asking to be taken to anyone.
 */
const JUDGES_ELSE = String.raw`(?:(?:the |all the |all of the |your |our )?(?:other|fellow|remaining|rest of the) (?:judges?|panelists|jurors?|organi[sz]ers?|sponsors?)|(?:the |your |our )?(?:panel|jury|committee|deliberations?|judging room))`

/** The ways of asking politely or hopefully, in front of an imperative. */
const LEAD = String.raw`(?:please|pls|plz|kindly|just|maybe|perhaps|do|go ahead and|feel free to|gotta|got to|you gotta|you have to|you need to|you must|you should|you could|could you|can you|would you|will you|why not|i hope you|we hope you|hope you|hoping you|let's hope you|want you to|need you to|ask you to|asking you to|we ask you to|we'd love you to|we would love you to|love for you to|if you|when you|once you|and|then)`

/** The rules, one regex source each (the tests name the rule that matched). */
export function broadPleaRules(names: readonly string[]): string[] {
    const spoken = names
        .map(spokenName)
        .filter((n): n is string => !!n)
        .map((n) => `(?:the )?${n}(?: (?:team|project|app|hack|crew|group))?`)
    const N = spoken.length ? `|${spoken.join("|")}` : ""
    /** The team as the object of a request. */
    const US = String.raw`(?:us|ourselves|our (?:team|project|app|hack|idea|entry|submission|table|booth|demo|work|build|product|names?|bid|pitch|presentation|prototype)|the team|this (?:team|project|app|hack|one|demo|submission|entry|bid|pitch|prototype)${N})`
    const HOPE_V = String.raw`(?:hope|hoping|hoped|hopes|wish|wishing|wished|pray|praying|prayed|beg|begging|begged|dream|dreaming|long|longing|pin|pinning)`
    return [
        // ── BACK ──────────────────────────────────────────────────────────────────────────
        String.raw`\b(?:root\w*|cheer\w*|pull\w*|fight\w*|campaign\w*|lobb\w+|advocat\w*|plead\w*|vouch\w*|argu\w*|push\w*|speak\w*|spoke|stand\w*|stood|stick\w*|bat)(?: up| out| on)? (?:for|on behalf of|behind|by) ${US}\b`,
        String.raw`\b(?:make|made|making) (?:the|a|our|your) case for ${US}\b`,
        String.raw`\b(?:go|going|went) to (?:bat|the mat) for ${US}\b`,
        String.raw`\bsing(?:ing)? (?:our|the team's|this team's|its|their) praises\b`,
        String.raw`\b(?:champion|endorse|shortlist|crown|reward|promote|spotlight|upvote|elevate|sponsor|hype|plug|bless|favou?r)(?:ing)? ${US}\b(?! (?:with|from|by)\b)`,
        String.raw`\b(?:${LEAD}) (?:[\w']+ ){0,2}?(?:recommend|pitch|back|support|approve|advance|bump|boost|trust|believe in|prefer|pick|choose|select|rank|rate|score|grade|nominate|remember|consider|vote for|stand behind|stand by|go with|think of|look at|look out for|watch)(?:ing)? ${US}\b(?! (?:up|off|out|on|from|at the|to (?:a|the|an)|a|an|some|by|with|via|through|using|at)\b)`,
        // ── NETWORK ───────────────────────────────────────────────────────────────────────
        String.raw`\b(?:tell|mention|speak to|talk to|talk with|pass (?:it|the word) (?:on |along )?to|spread the word (?:to|with|among)|steer|nudge|sway|persuade|convince|lobby|pitch|recommend|sell|plug|vouch to|put in a (?:good |kind )?word with|bring up|rave to|brag to|champion to|whisper to)(?: [\w']+){0,3}? ${JUDGES_ELSE}(?: [\w']+){0,5}? (?:about|of|on|for|toward|towards|to|at|re) ${US}\b`,
        String.raw`\b(?:talk|mention|bring|put|speak|sell|pitch|plug|hype|vouch|recommend|champion|advocate|argue|make the case|rave|brag|push|pass|carry|relay)(?:ing)?(?: [\w']+){0,4}? ${US}(?: [\w']+){0,6}? (?:to|with|before|in front of|in|during|at|among|for|toward|towards) ${JUDGES}\b`,
        String.raw`\b(?:mention|raise|push|argue|advocate|speak|vouch|stand up|fight|campaign|lobby|plead|champion|represent)(?:ing)?(?: [\w']+){0,4}? ${US}(?: [\w']+){0,3}? (?:in|during|at|before|for) (?:the |your |our |tonight's |final |judges' )?(?:deliberations?|voting|the vote|the judging|the discussion|the debate|the meeting)\b`,
        String.raw`\b(?:in|during|at|for) (?:the |your |our |tonight's |final |judges' )?(?:deliberations?|voting|the vote|the discussion)\b,? (?:(?:please|pls|kindly|just|do|also|and|to|you|could|can|would|will|might|may|should|remember|mention|bring|raise|speak|vouch|push|argue|advocate|think|keep|consider|champion|include|put|count|vote|pick|choose|rank|nominate|back|support|root|fight|stand|plead|lobby|campaign)(?: |'ll |'d )){1,5}${US}\b`,
        // ── PLACE ─────────────────────────────────────────────────────────────────────────
        String.raw`\b(?:put|place|move|bump|lift|send|bring|take|carry|get|help|let|propel|push|launch|advance|pass|wave|slot|squeeze|fit|add|include|count|list|rank|mark|tick|sign|write|log|note|pencil|jot|tag|keep|have|see|call|name|declare|make|vote|pick|choose|select|nominate|give|hand|award|grant|hold|find|save|reserve|secure|book|help get|help send|help put|land|forward|usher|guide|escort|shepherd|steer|lead|fast-?track|recommend|endorse|support|back|vouch for|propose|submit|promote|elevate|rocket|catapult|launch|hoist|raise|rate|grade)(?:ing)? ${US}(?: (?:[\w'-]+)){0,4}? ${GOAL}\b`,
        String.raw`\b(?:rank|rate|score|grade|mark|vote|put|place|list)(?:ing)? ${US}(?: (?:really|very|super))? (?:first|1st|top|highest|higher|high|highly|well|favou?rably|ahead|on top|at the top|number one|#1|a (?:10|ten|five|5)|10|ten|five stars?|5 stars?|full marks)\b`,
        String.raw`\b(?:put|place|move|bump|lift|rank|list|count|add|include|slot|squeeze|fit|keep|have) ${US}(?: [\w']+){0,3}? (?:in|on|at|near|to|toward|towards|into) (?:the )?(?:top |bottom |front |head )?(?:of )?(?:your|y'all's|the judges'?) (?:list|rankings?|standings|ballot|score ?sheets?|notes|picks?|shortlist|short list|top ?\d*|ranks|cards?)\b`,
        String.raw`\b(?:help|let|watch|see|make|get) ${US} (?:climb|rise|move up|go up|jump up|shoot up|soar|ascend|rank higher)(?: [\w']+){0,3}? (?:standings|rankings?|leaderboard|ranks|ladder|list|top)\b`,
        String.raw`\b(?:a|the|that|one) (?:spot|place|seat|slot|position|berth|ticket) (?:in|on|among|at) (?:the |your )?(?:top|finals?|final round|winners|podium|short ?list|winners' circle)\b`,
        String.raw`\b(?:please |pls |just |could you |can you |would you )?(?:give|grant|offer|hand) ${US} (?:a|one) (?:shot|chance|crack|opportunity|look|fair shot) (?:at|for|in|to win|to place) (?:gold|the gold|first|the top|the crown|the title|a prize|an award|the big prize|the win|the finals?|the prize)\b`,
        // ── COUNT ─────────────────────────────────────────────────────────────────────────
        String.raw`\b(?:counting|relying|depending|banking|betting|count|rely|depend|bank|bet)(?: [\w']+)? on (?:you|y'all|you all|you guys|the judges?|judges)\b(?! (?:to (?:read|be|use|test|try|check|know|see|find|help (?:us )?(?:test|try|improve|debug|fix|find)|give|tell|let|provide|bring|show|ask|answer|scan|tap|click|press|download|install)|for (?:feedback|input|help with|testing|bug)|in (?:the|our) (?:app|demo|room)|with (?:the )?(?:testing|feedback|bugs?))\b)`,
        String.raw`\b(?:need|needs|want|wants|ask|asking|require|appreciate|welcome|value|hope for|hoping for|beg|begging|pray for|praying for|count on|counting on|rely on|relying on|pleading for|appealing for|looking for|rooting for|cherish|treasure|savou?r|relish|adore|would love|would like|'d love|'d like)(?: [\w']+)? (?:your|y'all's|the judges'?) (?:help|assistance|support|vote|votes|backing|nomination|pick|word|ranking|recommendation|consideration|endorsement|blessing|advocacy|favou?r|score|rating|generosity|kindness|mercy|vote of confidence|thumbs up|nod|yes|good word|kind words?)(?: [\w']+){0,3}? (?:to (?:win|advance|place|get|make|reach|take|earn|secure|land|stand out|rank|be)|in (?:the |this )?(?:deliberations?|voting|judging|finals?|round)|with (?:the )?(?:panel|judges?))`,
        String.raw`\b(?:a|your|one|any|every|that|just a|just one)(?: (?:strong|kind|good|nice|quick|little|small|short|gentle|warm|favou?rable|single|simple|generous|positive|friendly|honest|word of))* (?:vote|votes|nod|word|words|nomination|recommendation|endorsement|pick|thumbs[- ]up|yes|push|boost|bump|mention|shout-?out|plug|backing|support|favou?r|champion|advocacy|ballot|score|ranking|rating|referral|pass)\b(?:(?: [\w']+){0,3}? (?:from you|to|with|for|in front of|before|at) (?:you|us|the |our |other |your |all the |fellow )*(?:panel|judges?|jury|committee|organi[sz]ers?|deliberations?|us|our team|our project)?)?(?: [\w']+){0,3}? (?:would|could|will|can|'d|'ll|might|may) (?:really |truly |just |honestly |so |greatly |hugely |all )*(?:mean|help|make|change|boost|lift|carry|seal|push|matter|go a long way|do wonders|get us|take us|put us|send us|be (?:huge|amazing|awesome|great|appreciated|everything|so|really|truly|a big|wonderful|incredible|fantastic|a game changer|massive|big|enormous|priceless))`,
        String.raw`\b(?:a|your|one|any|that)(?: (?:strong|kind|good|nice|quick|little|small|short|gentle|warm|favou?rable|single|simple|generous|positive|friendly|honest))* (?:vote|votes|nod|word|words|nomination|recommendation|endorsement|pick|thumbs[- ]up|yes|push|boost|bump|mention|shout-?out|plug|backing|support|favou?r|advocacy|ballot|score|ranking|rating)(?: from you| from the judges| from the panel)? (?:goes|go|changes|change|seals|seal|carries|carry|lifts|lift|means|mean|is|are) (?:a long way|everything|the world|so much|a lot|huge|massive|it|us)\b`,
        String.raw`\b(?:be|feel) (?:blessed|honou?red|lucky|grateful|thankful|thrilled|happy|delighted|stoked) (?:with|by|for|to have) your (?:favou?r|blessing|vote|support|help|backing|nod|endorsement|recommendation|pick|nomination|consideration)\b`,
        String.raw`\b(?:our|my) (?:last|only|best|final|biggest|one) (?:hope|chance|shot|wish|prayer) is (?:your|you|the judges)\b`,
        String.raw`\b(?:lend|give|grant|extend|offer|show|spare) (?:us|our team) (?:your|a|some|the) (?:support|endorsement|voice|name|vote|backing|word|weight|clout|nod|help|blessing|favou?r)\b`,
        String.raw`\b(?:hear|get) (?:you|the judges|a judge|someone) say(?:ing)? yes\b|\bsay yes to ${US}\b`,
        String.raw`\b(?:say|put in|drop|leave) (?:something|a few words|a word|a kind word|a good word|a nice word)(?: [\w']+){0,3}? (?:in|on|for) (?:our|my) (?:favou?r|behalf)\b|\bin our favou?r\b`,
        String.raw`\b(?:we're|we are|we|i)(?: (?:still|just|only|all))? (?:asking|looking|aiming|hoping|pushing|fighting|competing|pleading|begging|applying) for (?:a |the |your )?(?:spot|place|seat|slot|position|berth|ticket|chance|shot|bid) (?:in|on|at|to|for)\b`,
        // ── EASE ──────────────────────────────────────────────────────────────────────────
        String.raw`\b(?:go|going) easy on ${US}\b|\bbe (?:kind|nice|gentle|generous|lenient|fair|easy|gracious|merciful|good|soft) (?:to|with|on|in) ${US}\b|\btake it easy on ${US}\b|\bdon't be (?:too )?(?:harsh|hard|tough|strict) on ${US}\b`,
        String.raw`\bbe (?:kind|nice|gentle|generous|lenient|fair|easy|gracious|merciful|good|soft)(?: and (?:kind|nice|generous|fair))? (?:with|in|on|about|when) (?:your|the) (?:rank\w*|scor\w*|grad\w*|rating\w*|vote\w*|nominat\w*|marks|points|picks?|notes|numbers|judging|deliberat\w*)\b`,
        String.raw`\b(?:cut|give) ${US} (?:some |a little |a bit of |a )?(?:slack|break|leeway|mercy|grace)\b|\b(?:give|grant|extend) ${US} the benefit of the doubt\b|\bthe benefit of the doubt\b|\bspare ${US}\b`,
        String.raw`\b(?:weigh|rate|rank|score|grade|judge)(?:ing)? (?:${US}) (?:[\w']+ ){0,3}?(?:more|higher|heavily|favou?rably|kindly|generously|highly|well|better|up|a little higher)\b`,
        String.raw`\b(?:boost|raise|bump|lift|up|increase|inflate|improve|nudge|adjust|round up|add to|pad|pump up|juice|bump up) (?:our|my|the team's|us) (?:score|scores|rating|ranking|rank|grade|marks|points|numbers|standing|position|chances|odds|total)\b`,
        String.raw`\btip(?:ping)? the (?:scales|balance|odds) (?:our|in our|toward|towards|for|in favou?r)\b|\bput a thumb on the scale\b|\bpush(?:ing)? our (?:score|rank|ranking|name)\b`,
        String.raw`\b(?:push|pass|carry|move|send|forward|bump|lift|raise|promote) (?:along )?(?:our|my|this) (?:name|names|project|team|app|hack|demo|idea|entry|submission|table|work) (?:along|forward|up|ahead|through|to the (?:top|front|finals?|next|podium|shortlist)|up the (?:list|ranks|ladder|standings))\b`,
        String.raw`\b(?:please |pls |kindly )?(?:judge|grade|score|rate|rank) (?:us|our (?:project|team|app|hack|idea|demo|work)${N}) (?:kindly|gently|generously|favou?rably|nicely|fairly|leniently|softly)\b`,
        // ── HOPE ──────────────────────────────────────────────────────────────────────────
        String.raw`\b(?:we|our team|our (?:project|app|hack)|i)(?:'d| would| will|'ll|'re| are| really| truly| just| so| all| absolutely| definitely)* (?:be|feel) (?:thrilled|honou?red|delighted|happy|grateful|stoked|ecstatic|over the moon|so happy|proud|excited|blessed|humbled|elated|overjoyed)(?: (?:to|if|by|with|about|that|for))?(?: [\w']+){0,2}? (?:be )?(?:selected|chosen|picked|nominated|considered|recogni[sz]ed|rewarded|advanced|ranked|shortlisted|crowned|named|awarded|honou?red|promoted|backed|supported|favou?red|endorsed|advance|progress|qualify|proceed|win|place|rank|a finalist|finalists?|in the finals|the finals|on the podium|make the cut)\b`,
        String.raw`\b(?:${HOPE_V}) (?:so much |really |very much |hard )?(?:${LEAD} )?(?:we|you|the judges?|judges|the panel|${US})\b(?: [\w']+){0,4}? (?:crack|make|reach|land|get|win|place|clear|qualify|sneak|squeeze|advance|go|move|finish|rank|pick|choose|nominate|back|support|remember|consider|favou?r|like|love|enjoy|see|notice|appreciate|recogni[sz]e|value|believe|take a liking)\b(?: [\w']+){0,5}? (?:${GOAL}|us|our (?:demo|project|work|app|hack|idea|potential|vision|effort|submission|team|pitch)|what we (?:built|made|did|showed|have)|the (?:work|effort|potential|vision) we)`,
        String.raw`\b(?:let's hope|lets hope|here's hoping|heres hoping|fingers crossed|crossing our fingers|knock on wood)\b[^.!?;]{0,40}?\b(?:${GOAL}|the judges?|the panel|the jury|you pick|you like|you choose|you vote)\b`,
        String.raw`\b(?:hope|hoping|wish|wishing)(?: that)? (?:you|y'all|the judges?|judges|the panel) (?:see|recogni[sz]e|appreciate|notice|value|believe in|get|understand|feel|sense|find|think) (?:our|the) (?:potential|vision|work|value|promise|effort|hard work|talent|idea|passion|heart|story|mission)\b`,
        String.raw`\b(?:hope|hoping|wish|wishing)(?: that)? (?:you|y'all|the judges?|judges|the panel)(?:'ll| will| can| could| might| do)? (?:name|call|label|list|mark|count|put|place|keep|take|treat|regard|see|view|find|deem|judge|rank|rate|score|write|squeeze|sneak) (?:${US})\b`,
        String.raw`\b(?:hope|hoping|hopes) (?:you|y'all|the judges?|judges|the panel)(?:'ll| will| can| could| might)? (?:like|love|enjoy|liked|loved|enjoyed) (?:what we (?:built|made|did|showed|have)|our (?:project|work|demo|app|idea|hack|submission|pitch)|us|it)\b`,
        String.raw`\b(?:we|i|our team)(?:'d| would|'re| are| really| truly| just| so| all)* (?:love|like|appreciate|welcome|take|accept|want|need) (?:a|an|any|your|some|the|that|this|those|these|one|another|more)(?: (?:warm|kind|good|nice|strong|small|little|quick|positive|favou?rable|friendly|generous|honest|judges?'?s?|panel|jury|committee))* (?:mention|nod|vote|endorsement|recommendation|word|words|shout-?out|plug|push|boost|bump|thumbs[- ]up|yes|pick|nomination|support|backing|favou?r|sponsorship|recognition|attention|look)(?: from you| from the judges| from the panel)?\b`,
        String.raw`\b(?:we|i|our team)(?:'d| would|'re| are| really| truly| just| so| all)* (?:love|like|hope|want|wish|need|aim|plan|try|trying|hoping|aiming|planning|dreaming) to (?:advance|clear|pass|survive|make|get past|get through|reach|win|take|bag|snag|claim|walk away with|go home with|bring home|earn|land|secure)(?: [\w']+){0,2}? (?:${GOAL}|the (?:first |next |final )?(?:cut|round|hurdle|screening)|${NAMED})\b`,
        String.raw`\b(?:we|i|our team)(?:'d| would|'re| are| really| truly| just| so| all)* (?:love|like|hope|want|wish|need|dream|aim|plan|try) (?:to )?(?:take|get|win|grab|land|earn|bag|snag|claim|have|receive|bring home|walk away with|go home with|take home) (?:the |a |an )?${NAMED}\b`,
        String.raw`\b(?:${HOPE_V}) (?:we|that we|our team|our (?:project|app|hack))\b(?: [\w']+){0,3}? (?:get|are|is|be|make|win|take|place|advance) (?:noticed|recogni[sz]ed|rewarded|selected|chosen|picked|shortlisted|a finalist|in the finals|the finals|the top|on the podium)\b`,
        String.raw`\b(?:i|we)(?:'m| am| are|'re)? (?:begging|pleading|praying|appealing) (?:you|the judges|for)\b`,
        // ── ATTEND ────────────────────────────────────────────────────────────────────────
        String.raw`\b(?:make sure|ensure|see to it|be sure|get|help get|help|have|let|make) (?:that )?${JUDGES}(?: [\w']+){0,2}? (?:see|notice|hear|hear about|remember|know|know about|find|pick|choose|rank|nominate|consider|read|look at|visit|check out|stop by|get to|come to|take notice of) (?:us|our)\b`,
        String.raw`\b(?:don't|do not|dont|never|please don't|please do not|pls don't)(?: [\w']+)? (?:let|make|leave|forget|overlook|skip|miss|ignore|lose|drop|pass over|pass on|brush off|write off|dismiss|discount|underestimate|count out|sleep on|leave out|leave off|leave behind) ${US}(?: (?:slip|fall|drop|fade|get lost|go unnoticed|go unseen|out|off|behind|through))?\b`,
        String.raw`\b(?:don't|do not|dont|never|please don't|please do not)(?: [\w']+)? let ${US} (?:slip|fall|drop|fade|get lost|go unnoticed|go unseen)\b`,
        String.raw`\b(?:spare|save|give|set aside|find|take) (?:us|our team) (?:a|some|one) (?:moment|minute|line|spot|note|mention|space|place|thought|second|look)\b(?: [\w']+){0,3}? (?:in|on|to|for) (?:your|the) (?:notes|list|ballot|rankings?|scoresheet|score ?sheet|picks?|deliberations?)`,
        String.raw`\bdo (?:us|our team) a (?:huge |big |great |real |solid |quick |small )?favou?r\b`,
        // ── MORE: other nouns, other verbs, other asks ────────────────────────────────────────
        // A noun phrase of support, then what it does ("a nod from you matters", "judge support
        // would make our day", "a recommendation from you helps").
        String.raw`\b(?:(?:a|an|your|one|any|that|just a|just one)(?: (?:strong|kind|good|nice|quick|little|small|short|gentle|warm|favou?rable|single|simple|generous|positive|friendly|honest|word of))* |(?:judges?'?s?|panel|jury|committee|judging) )(?:vote|votes|nod|nods|word|words|nomination|recommendation|endorsement|pick|thumbs[- ]up|yes|push|nudge|boost|bump|mention|shout-?out|plug|backing|support|favou?r|advocacy|referral|vote of confidence|blessing)\b(?:(?: [\w']+){0,3}? (?:from you|from the judges|from the panel|to the (?:panel|judges?)|to panel|with the (?:panel|judges?)))?(?: (?:would|could|will|can|'d|'ll|might|may|really|truly|just|honestly|so|greatly|hugely|all))* (?:matters?|helps?|counts?|works wonders|does wonders|goes a long way|go a long way|means? (?:a lot|the world|everything|so much)|is (?:huge|everything|key|gold|appreciated|enough)|would make our day|make our day|makes our day|carry us|carries us|get us|gets us|lift us|lifts us|seals? it|changes? everything)\b`,
        String.raw`\b(?:we|i|our team)(?:'d| would|'re| are| really| truly| just| so| all)* (?:be )?(?:thankful|grateful|glad|happy|pleased|lucky|content|excited|down|ready|delighted|stoked|thrilled|honou?red)(?: (?:for|with|by|to (?:take|get|have|receive|be given|be picked|be chosen)))?(?: (?:a|an|any|your|the|some|that|one|this|another|more))?(?: [\w'-]+){0,2}? (?:nomination|vote|votes|nod|mention|prize|award|trophy|spot|place|slot|wildcard|favou?r|push|nudge|boost|bump|podium|finalist|shortlist|recognition|endorsement)\b`,
        String.raw`\b(?:we|i|our team)(?:'d| would|'re| are| really| truly| just| so| all)* (?:cherish|treasure|savou?r|relish|adore|dig|settle for|take|accept|cheer for|root for|jump at|leap at|snap up|go for) (?:a|an|any|your|the|some|that|one|this|another|more)(?: [\w'-]+){0,2}? (?:nomination|vote|votes|nod|mention|prize|award|trophy|spot|place|slot|wildcard|favou?r|push|nudge|boost|bump|podium|finalist|shortlist|recognition|endorsement|top (?:spot|five|three|ten))\b`,
        String.raw`\b(?:we|i|our team|our (?:project|app|hack))(?:'d| would|'ll| will|'re| are| really| truly| just| so| all| absolutely| definitely| still| both)* (?:love|like|hope|hoping|hoped|wish|wishing|want|wanted|wanna|long|longing|yearn|yearning|dream|dreaming|pray|praying|beg|begging|aim|aiming|plan|planning|aspire|aspiring|try|trying|ready|here|going|gonna|dying)(?: to| for| of| that we)? (?:be |get |make |making |reach |reaching |land |landing |win |take |earn |claim |grab |secure |bag |snag |have |finish in |finish )?(?:the |a |an |your )?(?:${GOAL})\b`,
        String.raw`\b(?:we|i|our team)(?:'d| would|'ll| will|'re| are| really| truly| just| so| all| absolutely| definitely| still| both)* (?:love|like|hope|hoping|wish|wishing|want|wanna|long|longing|yearn|yearning|dream|dreaming|pray|praying|aim|aiming|plan|planning|aspire|aspiring|try|trying) (?:to |of |for )?(?:advance|progress|qualify|place|go through|get through|make it|move on|move forward|proceed|go forward|go on|finish first|rank first|rank high)(?= *(?:$|[.,!?;:])| (?:tonight|today|to |into |through |on\b|forward|further|this|past|together)\b)`,
        String.raw`\b(?:we|i|our team|our (?:project|app|hack))(?: (?:really|definitely|all|just|are|'re|still|truly))* (?:aim|aiming|gun|gunning|shoot|shooting|go|going|compete|competing|vie|vying|strive|striving|reach|reaching|push|pushing|fight|fighting|angle|angling|work|working|play|playing|here|in it) for (?:the |a |an |your )?(?:${GOAL})\b`,
        // The ask to the judge in a question or a request, with a verb of favour ("could you
        // give us a boost", "can you find a place for us", "could you hold a spot open").
        String.raw`\b(?:give|lend|offer|grant) ${US} (?:a|an|some|one|your) (?:boost|nudge|push|bump|lift|leg up|nod|plug|mention|vote|nomination|favou?r|endorsement|recommendation|shout-?out|word)\b`,
        String.raw`\b(?:find|make|save|hold|reserve|keep|leave|set aside) (?:a|some|one|the|our) (?:room|space|spot|place|seat|slot)(?: [\w']+){0,2}? (?:for ${US}|open|aside)\b`,
        String.raw`\b(?:help|assist|support) ${US} (?:out )?(?:by|with) (?:nominating|picking|choosing|voting|ranking|selecting|recommending|backing|advocating|endorsing|scoring|rating|mentioning|telling|putting|giving|remembering|considering)\b`,
        String.raw`\bspread(?:ing)? (?:the )?(?:word|news) (?:to|with|among) ${JUDGES}\b|\b(?:whisper|drop|slip|float|raise|put forward|put in|bring up)\w*(?: [\w']+){0,2}? (?:our|my) (?:name|names|case|story|pitch|project|team|demo|work|bid)(?: [\w']+){0,3}? (?:to|with|before|in front of|among|for) ${JUDGES}\b|\b(?:make|made|making) (?:our|my) (?:case|pitch|argument) (?:to|with|before|in front of|among|for) ${JUDGES}\b`,
        String.raw`(?:^|[,.;:!?] ?)(?:back|recommend|support|rank|endorse|champion|remember|consider|stand behind|bring up|go to bat for) ${US}\b(?! (?:up|off|out|on|from|at the|a\b|an\b|some\b)\b)`,
        String.raw`\b(?:all|only) (?:we|i) (?:need|want|ask(?: for)?) is (?:your|a|one|the) (?:vote|nomination|nod|pick|recommendation|endorsement|yes|word|support|help|backing)\b|\b(?:one|a single|just one|just a) (?:vote|nomination|nod|pick|recommendation|endorsement|word)(?: from (?:you|a judge|one judge))?(?: is all| and we're| and we are| and we'll| would be enough| will do| should do)\b|\b(?:one|a single|just one|just a) (?:vote|nomination|nod|pick) (?:is )?all it takes\b`,
        String.raw`\b(?:vot(?:e|ed|ing|es)|swing|swung|lean|leaned|tilt|tilted|break|breaks|went|go|goes|going) (?:our|my) way\b`,
        String.raw`\b(?:hope|hoping|wish|wishing)\b[^.!?;]{0,40}?\b(?:sticks?|stays?|resonates?|lands?|impress\w*|stands? out|speaks?|connects?|wins? you over|works? for you) (?:with|to|for|in)? ?(?:you|the judges?|the panel)\b`,
        // A request to the judge to back the team, in the second person ("we'd appreciate you
        // defending our work", "could you move us forward", "might you advance us tonight").
        String.raw`\b(?:appreciate|love|like|want|need|hope|hoping|welcome|value|ask|asking|beg|begging|wish)(?: it)?(?: if| when| that| for)? you(?:'d| would| could| can| might| to)? (?:[\w']+ ){0,2}?(?:defend|support|champion|advocat|back|vouch|speak|push|fight|stand|argu|root|promot|recommend|endors|nominat|rank|vot|pick|choos|select|remember|consider|mention|rate|scor|favou?r|reward|boost|lift|help|advanc|mov|forward|carry|elevat)\w* (?:for |on behalf of |up for )?${US}\b`,
        String.raw`\b(?:could|can|would|will|might|may|should) (?:you|y'all|you all|the judges?|the panel|someone|anyone)(?: all)?(?: [\w']+)? (?:move|advance|push|promote|boost|lift|carry|forward|pass|send|bump|elevate|propel|put|rank|rate|nominate|pick|choose|select|back|support|endorse|recommend|champion|vouch for) ${US}\b(?! (?:the|a|an|that|this|your|my|our|some|how|what|where|when|which)\b)`,
        String.raw`\b(?:grant|give|offer|allow|afford|extend|hand) ${US} (?:a|one|another|the) (?:chance|shot|opportunity|break|slot|stage slot|prize|award|trophy|nomination|medal|win|spot|place|nod|vote)\b`,
        String.raw`\b(?:ask|asking|beg|begging|plead|pleading|appeal|appealing|apply|applying|pray|praying)(?: (?:nicely|politely|kindly|humbly))? for (?:a|an|the|your|one|some)(?: [\w']+){0,2}? (?:chance|shot|favou?r|nod|nomination|spot|place|slot|prize|award|break|push|vote|mention|endorsement|recommendation|support|backing)\b`,
        String.raw`\b(?:pray|beg|hope|wish|plead|ask|appeal)\w* for (?:the )?(?:judges?'?s?|panel|jury|committee) (?:support|favou?r|nod|vote|push|backing|blessing|mercy|note|call)\b`,
        String.raw`\b(?:hate|hates|dread|fear|afraid|worried|scared)\b[^.!?;]{0,25}?\b(?:miss|overlook|skip|forget|ignore|pass over)\w* (?:us|our)\b`,
        String.raw`\b(?:we|i|our team)(?:'d| would|'re| are| really| truly| just| so| all)* (?:celebrate|cheer|dance|party|rejoice|jump for joy)(?: for| about| at| over)? (?:a|an|any|the|your)(?: [\w'-]+){0,2}? (?:nomination|prize|award|trophy|spot|place|slot|finalist|shortlist|podium|win|top (?:spot|five|three|ten)|first place)\b`,
        String.raw`\b(?:make|made|making|clear|cleared|clearing|pass|passed|passing|survive|survived|surviving) the (?:first |next |final |second )?cut\b(?= *(?:$|[.,!?;:]|\s+(?:tonight|today|please|together|too|and|for sure|here)\b))`,
        String.raw`\b(?:please |pls |kindly )?(?:remember|think of|think about|keep in mind|consider|don't forget|do not forget) ${US}\b(?! (?:as|like|when it|when you|while you|if|because|since|in the app)\b)(?= *(?:$|[.,!?;:]| (?:tonight|later|today|when|while|once|at|for|during|please|guys|okay|ok|too|on your|as you|before you|after you)\b))`,
    ]
}

export const broadPleaSource = (names: readonly string[]): string =>
    broadPleaRules(names).join("|")

const cache = new Map<string, RegExp>()
/** The broad plea rules with the project's name as an extra "us" (cached per name). */
export function broadPleaFor(names: readonly string[] = []): RegExp {
    const key = names.join("\u0000")
    let re = cache.get(key)
    if (!re) {
        re = new RegExp(broadPleaSource(names), "i")
        if (cache.size > 256) cache.clear()
        cache.set(key, re)
    }
    return re
}
