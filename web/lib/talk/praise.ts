/**
 * Verdict and praise wording, by class (W3b). extract.ts's VERDICT is a list of phrases; every
 * sweep of it left near rewordings of the same classes behind ("very strong", "a joy to use",
 * "best in class", "the cleanest code in the whole hackathon"). This adds the classes themselves,
 * so a reworded sentence of a known class is caught without its phrase being listed:
 *
 *   WORD    words that only ever judge ("groundbreaking", "unbeatable", "bulletproof")
 *   PHRASE  idioms of admiration and of ranking above others ("a cut above", "a joy to use")
 *   AESTHETIC / SOFT  an evaluative adjective said OF the work, as a predicate ("the pitch was
 *           confident and sharp"), after an intensifier ("very elegant"), or before a project
 *           noun ("slick interface"); soft ones that are also technical words (clean, strong,
 *           smooth) need the intensifier or a project noun
 *   ADVERB  admiration in an adverb ("impressively tidy", "elegantly handles")
 *   RANK    the work set above the room ("better than anything else here", "outshines the other
 *           submissions", "the cleanest code in the whole hackathon", "we have the strongest
 *           foundation")
 *   BARE    a short clause that is nothing but an evaluation ("very strong", "clean and
 *           polished", "slick interface")
 *
 * Every class excludes its describing sense (a "strong password", "we polished the UI", "better
 * than the baseline", "the best route"). Text arrives folded and lowercased (foldText); no
 * lookbehind, so it loads on older phone browsers. Bounded repetition only.
 */

/** An intensifier that modifies an adjective ("very", "so", "really", …): not a verb's adverb. */
const INTENS_ADJ = String.raw`(?:very|really|truly|genuinely|extremely|incredibly|super|so|pretty|quite|insanely|remarkably|refreshingly|wonderfully|deeply|especially|particularly|exceptionally|absolutely|utterly|totally|seriously|surprisingly|impressively|unbelievably|ridiculously|crazy|rather|fairly|mighty|wildly|immensely|hugely|massively|thoroughly|strikingly|stunningly|amazingly|spectacularly|stupidly|criminally|painfully|unusually|endlessly)`
/** Adverbs that also modify a verb ("we just polished it"): fine after a copula, not alone. */
const INTENS_ANY = String.raw`(?:${INTENS_ADJ}|just|simply|honestly|easily|clearly|obviously|definitely|certainly|properly|consistently|undeniably|undoubtedly|quietly|effortlessly|damn|dang|hella|way|literally|actually|basically)`
const INTENS = INTENS_ANY

/** Words that only ever judge the work (never a term, never a thing the app does). */
const WORD = String.raw`(?:revolutionary|ground[- ]?breaking|game[- ]?chang(?:er|ers|ing)|bullet[- ]?proof|rock[- ]?solid|(?:industry|market|class|category)[- ]leading|unbeatable|unstoppable|invincible|unparalleled|unsurpassed|incomparable|matchless|unequall?ed|unrivall?ed|unmatched|peerless|superlative|sublime|genius|ingenious(?:ly)?|masterful(?:ly)?|masterclass|delightful(?:ly)?|exquisite(?:ly)?|splendid(?:ly)?|glorious(?:ly)?|majestic(?:ally)?|faultless(?:ly)?|immaculate(?:ly)?|spotless(?:ly)?|dazzling(?:ly)?|awe[- ]inspiring|jaw[- ]?dropping|mind[- ]?blowing|mind[- ]?bending|show[- ]?stopp(?:er|ers|ing)|crowd[- ]?(?:pleaser|pleasing|favou?rite)|fan[- ]?favou?rite|head[- ]?turn(?:er|ers|ing)|eye[- ]catching|eye[- ]opening|scene[- ]?stealer|stunning(?:ly)?|astonishing(?:ly)?|astounding(?:ly)?|extraordinar(?:y|ily)|phenomenal(?:ly)?|spectacular(?:ly)?|breathtaking(?:ly)?|mesmeri[sz]ing(?:ly)?|captivating(?:ly)?|enchanting(?:ly)?|riveting|unforgettable|first[- ]?class|first[- ]?rate|world[- ]?class|best[- ]?in[- ]?(?:class|show|breed)|best[- ]?of[- ]?breed|gold[- ]?standard|thrilling(?:ly)?|exhilarating|electrifying|heart[- ]?warming|uplifting)`

/** Idioms that only ever praise the work or set it above the others. */
const PHRASE = [
    String.raw`\b(?:a|an|the) (?:joy|pleasure|delight|dream|breeze|treat|thrill) to (?:use|watch|see|behold|work with|look at|play with|read|try|operate|navigate)\b`,
    String.raw`\b(?:a|an) (?:work|piece|thing|labou?r|masterpiece|triumph|gem) (?:of (?:art|beauty|love|genius)|to behold)\b`,
    String.raw`\b(?:a|an|one) (?:class|cut|step|notch|level|tier|league|world) (?:above|apart|ahead)\b`,
    String.raw`\b(?:on|in) (?:another|a different|a whole other|a whole different|a higher|an entirely different) (?:level|league|tier|planet|universe|class|plane)\b`,
    String.raw`\b(?:in )?a (?:class|league|category|world) (?:of (?:its|their|our) own|all (?:its|their|our) own|by (?:itself|themselves|ourselves))\b`,
    String.raw`\b(?:head and shoulders|streets|miles|leagues|worlds|lightyears|light years|years|decades) (?:above|ahead|apart)\b`,
    String.raw`\bnothing (?:else )?(?:here )?(?:comes|came|even comes|even came|gets) (?:close|near|anywhere near)\b|\bnothing (?:else )?(?:compares|beats|touches|matches|rivals|even compares|even comes close|here compares)\b|\bnothing like (?:it|this|that)\b`,
    String.raw`\b(?:stole|steals|stealing|steal) the show\b|\bout of the (?:park|ballpark)\b|\b(?:turn|turned|turns|turning) heads\b`,
    String.raw`\b(?:well done|good job|nice job|great job|good work|nice work|great work|amazing work|solid work|excellent work|fantastic work|beautiful work|brilliant work|lovely work|kudos|bravo|congrats|congratulations|props to|hats? off|hat's off|well played|well deserved|chapeau)\b`,
    String.raw`\b(?:is|was|were|'s|'re|are|looked|looks|feels|felt|that's|thats|you're) (?:totally |absolutely |just |completely |exactly |simply )?(?:spot on|on point|on the money|the real deal|the whole package|the complete package|top of the class|best of the best|the cream of the crop|a hard act to follow|hard to beat|tough to beat|impossible to beat)\b`,
    String.raw`\b(?:the )?(?:real deal|whole package|complete package|cream of the crop|pick of the (?:bunch|litter|crop)|best of the best|top of the (?:class|pack|heap|field|game)|hard act to follow)\b`,
    String.raw`\b(?:can't|cannot|can not|couldn't|won't|will not) (?:be )?(?:beat(?:en)?|topped|matched|touched|rivall?ed|surpassed|outdone)\b`,
    String.raw`\b(?:the |a )?highlight of the (?:night|day|show|event|hackathon|weekend|expo|evening|floor|room)\b`,
    String.raw`\b(?:jump|jumps|jumped|pop|pops|popped|leap|leaps|leaped|leapt) (?:right )?off the (?:screen|page)\b`,
    String.raw`\bpure (?:delight|magic|genius|joy|class|art|gold|poetry|brilliance|perfection)\b`,
    String.raw`\btextbook (?:clean|perfect|example|design|execution|architecture|implementation)\b`,
    String.raw`\b(?:reads?|read|looks?|looked|feels?|felt|plays?|played) like (?:a |an )?(?:textbook|masterclass|magazine|dream|novel|poem|work of art|painting|million (?:bucks|dollars)|gallery|movie|commercial)\b`,
    String.raw`\b(?:looks?|looked|feels?|felt|seems?|seemed|sounds?|sounded) (?:like|as if|as though) (?:a |an )?(?:real|shipped|finished|professional|commercial|production|polished|actual|released|launched|published|funded|big-?budget)(?: [\w-]+)? (?:product|app|startup|company|release|commercial|brand|service|tool|thing|platform)\b`,
    String.raw`\b(?:professionally|beautifully|carefully|expertly|lovingly|painstakingly|meticulously|thoughtfully|tastefully|skillfully|artfully) (?:done|built|made|designed|executed|crafted|finished|written|structured|engineered|put together|assembled|thought out)\b`,
    String.raw`\b(?:is|was|looks|looked|feels|felt|'s|are|were)(?: (?:already|totally|fully|completely|basically|pretty much|practically|virtually|honestly|really|actually))* (?:ready to ship|ready for production|ready for launch|production-?ready|launch-?ready|market-?ready|shippable)\b`,
    String.raw`\b(?:hand-?crafted|handmade|craftsmanship|attention to detail|crafted with care|lovingly crafted|obsess\w* over (?:the )?details?|every detail (?:is|was|has been))\b`,
    String.raw`\b(?:clearly|obviously|definitely|really|truly|certainly) (?:knows?|knew) (?:their|his|her|your|its) (?:craft|stuff|onions|business|trade|game)\b|\b(?:know|knows|knew) (?:exactly )?what (?:they're|they are|they were|it's|it is|you're|you are) doing\b`,
    String.raw`\b(?:blown|blew|blow|blows|blowing) (?:me|us|everyone|everybody|the judges?|the room|the crowd|my mind|our minds?) away\b|\bwowed (?:me|us|everyone|the judges?)\b|\b(?:i|we)(?:'m| am|'ve been|'ve| are|'re| were| was) (?:totally |completely |absolutely |really |truly )?(?:blown away|floored|wowed|stunned|in awe|speechless)\b`,
    String.raw`\b(?:what|such) an? (?:[\w-]+ ){0,2}?(?:beauty|gem|treat|triumph|masterpiece|delight|stunner|banger|beast|achievement|accomplishment|feat)\b|\bwhat an? (?:great|nice|neat|lovely|beautiful|brilliant|cool|tidy|sweet|gorgeous|fantastic|amazing|awesome|wonderful|clever|impressive) (?:[\w-]+ )?(?:prototype|demo|app|project|hack|build|idea|product|pitch|design|solution|interface|ui|ux)\b`,
    String.raw`\b(?:genuine|real|true|total|absolute|certified|clear) (?:crowd|fan)[- ]favou?rite\b|\b(?:crowd|fan)[- ]favou?rite\b`,
    String.raw`\b(?:a|an|the) (?:true |real |clear |obvious |absolute |total |genuine )?(?:standout|stand-out|showstopper|stunner|knockout|banger|beast|gem|treasure|marvel|wonder)\b`,
    String.raw`\b(?:sets?|setting|raised|raises|raising|redefin\w+|defin\w+|rewrit\w+) (?:the |a |new )?(?:bar|standard|benchmark|yardstick|category)\b|\bthe (?:bar|standard) (?:has been|was|is|got|gets) (?:set|raised|reset)\b|\b(?:is|are|'s|'re|was) (?:the )?(?:benchmark|yardstick|gold standard)\b(?! (?:for|of|in|dataset|data|model|suite|test|set|run|runs|score|scores|results?|against|we|you|to)\b)`,
    String.raw`\bstands? (?:alone|apart|tall|out from|above|head and shoulders)\b|\b(?:alone )?at the top of (?:the )?(?:class|pack|field|heap|game|room|floor)\b`,
    String.raw`\b(?:exceed(?:s|ed|ing)?|surpass(?:es|ed|ing)?|beat|beats|beating|went|goes|going|delivered|delivers|delivering) (?:far |well |way |all |every |any )?(?:beyond|above|past|all|every|any) (?:the )?(?:expectations?|requirements?|brief|spec|ask|bar|hopes|goals?|metrics?|benchmarks?)\b`,
    String.raw`\b(?:the )?(?:one|team|project|app|hack|build|demo|entry|submission) (?:everyone|everybody|the rest|others|the others|all the others) (?:is|are|will be|should be|has to|have to|must|needs? to) (?:chasing|trying to beat|measured against|compared to)\b`,
    String.raw`\b(?:blew|blows|blow|blown) away (?:the )?(?:whole |entire |all the )?(?:panel|room|crowd|judges?|audience|jury)\b`,
    String.raw`\bwhat an? (?:[\w-]+ ){0,2}?(?:polished|slick|sleek|elegant|tasteful|beautiful|gorgeous|lovely|stunning|clever|ingenious|impressive|brilliant|amazing|awesome|fantastic|incredible|wonderful|neat|cool|nice|great|sweet|tidy|gem|treat|beauty|stunner)\b`,
    String.raw`\bwow[- ](?:factor|moment|effect|worthy|power|value)\b|\b(?:hit|hits|hitting|hit the|hits the) (?:the )?sweet spot\b`,
    String.raw`\b(?:built|made|created|shipped|delivered|produced) something (?:${INTENS_ADJ} )?(?:special|amazing|incredible|beautiful|magical|great|remarkable|wonderful|extraordinary|unique|stunning)\b`,
    String.raw`\b(?:real|such|some|great|true|fine|nice|serious|careful|obvious|evident|genuine|pure|sheer|rare)(?: [\w-]+)? (?:craft|craftsmanship|finesse|flair|charm|elegance|taste|class|artistry|swagger|panache|pizzazz|sparkle)\b|\b(?:real|such|great|true|genuine) polish\b`,
    String.raw`\b(?:creative|real|genuine) spark\b|\bspark of (?:genius|creativity|brilliance|magic)\b`,
    String.raw`\b(?:delight|delighted|delights|wowed|amazed|impressed|charmed|dazzled|stunned) (?:everyone|everybody|us|me|the judges?|the crowd|the room|the audience|the panel)\b`,
    String.raw`\b(?:have to|gotta|got to|must|can't help but|cannot help but) (?:admire|applaud|salute|respect|love)\b`,
    String.raw`\b(?:over the moon|thrilled|delighted|stoked|blown away|pumped) (?:with|by|about|at) (?:that|this|the|our|their|how) (?:demo|project|app|build|result|results|outcome|pitch|prototype|hack|work|performance|presentation)\b`,
    String.raw`\bmade? (?:it|the [\w ]{1,24}?|that|this) look (?:so )?(?:easy|simple|effortless|trivial)\b|\blook(?:s|ed)? (?:so )?effortless\b`,
    String.raw`\bthe only (?:production[- ]ready|polished|professional|finished|serious|truly [a-z]+)(?: [\w-]+)? (?:demo|project|app|product|entry|submission|hack|team|solution|contender)\b`,
    String.raw`\b(?:clearly|obviously|easily|definitely|certainly|really|just|simply|honestly)? ?(?:in|on) (?:a|its) (?:whole )?(?:different|another|higher|other) (?:level|league|class|tier|plane)\b`,
]

/**
 * Evaluative adjectives said of the work (not technical words): said as a predicate, after an
 * intensifier, or before a project noun, they are a verdict.
 */
const HARD_PRAISE = String.raw`(?:polished|slick|sleek|elegant|tasteful|refined|sophisticated|classy|charming|delightful|exquisite|gorgeous|stunning|lovely|beautiful|handsome|tidy|spotless|immaculate|seamless|effortless|frictionless|magical|flawless|impeccable|ingenious|inspiring|inspirational|impressive|remarkable|memorable|compelling|captivating|thrilling|stellar|superb|terrific|fabulous|fantastic|incredible|amazing|awesome|outstanding|excellent|exceptional|brilliant|wonderful|marvel?lous|magnificent|splendid|glorious|sublime|phenomenal|spectacular|breathtaking|extraordinary|unreal|unbelievable|top-?notch|buttery|silky|crisp|snappy|graceful|artful|masterful|skillful|skilful|deft|genius|first-?rate|world-?class|well[- ](?:designed|built|made|done|executed|crafted|thought[- ]out|put[- ]together|engineered|structured|organi[sz]ed|written|documented|tested|architected|polished|presented|rounded|constructed|implemented)|thought[- ]out)`
/** Praise that is also said of people or of things other than the work: needs the work as its subject. */
const WORK_PRAISE = String.raw`(?:thoughtful|clever|engaging|confident|persuasive|convincing|professional|cohesive|accomplished)`
const AESTHETIC = String.raw`(?:${HARD_PRAISE}|${WORK_PRAISE})`

/**
 * Soft ones that are also technical or everyday words: a verdict only after an intensifier or
 * with a project noun, never alone ("clean data", "a strong password", "a smooth surface").
 */
const SOFT = String.raw`(?:clean|solid|strong|smart|smooth|fun|neat|sharp|tight|good|great|nice|cool|sweet|fresh|original|innovative|inventive|creative|ambitious|bold|mature|intuitive|robust|special|finished|premium|passionate)`

/** What the work is called: the nouns a verdict adjective modifies. */
const WORK = String.raw`(?:app|apps|demo|demos|project|projects|ui|ux|ui/ux|interface|design|designs|idea|ideas|product|solution|prototype|backend|back-?end|frontend|front-?end|architecture|code|codebase|implementation|execution|pitch|presentation|work|team|hack|hacks|build|builds|submission|entry|craftsmanship|onboarding|flow|experience|polish|engineering|stack|api|layout|animation|animations|transition|transitions|palette|colou?rs|typography|branding|logo|writing|write-?up|docs|documentation|readme|visuals?|graphics|mockups?|wireframes?|icons?|illustrations?|theme|copy|wording|story|storytelling|performance|effort|attempt|approach|concept|vision|platform|tool|tools|service|system|pipeline|model|dashboard|website|site|page|screen|screens|mobile app|web app|walkthrough|walk-through|tutorial|video|trailer|slides|deck|script|name|branding|polish|finish|feel|vibe|vibes|interactions?|details?|choices|touches|decisions|motion|aesthetic|aesthetics|user experience|concept|spark|polish)`

/** The thing a verdict is said about: "this", "the ui", "their pitch", "our solution". */
const SUBJECT = String.raw`(?:this|that|it|ours|everything|all of it|the whole thing|the whole (?:build|app|project|demo|thing|package)|(?:the|this|that|their|our|your|its|his|her|these|those|my|the team's) (?:[\w'-]+ ){0,2}?${WORK})`

/** A copula or a verb of seeming. */
const COPULA = String.raw`(?:is|was|are|were|'s|'re|looks?|looked|feels?|felt|seems?|seemed|sounds?|sounded|reads?|came out|comes out|turned out|turns out|comes across|came across|has been|have been|had been|will be|'ll be|would be|should be|remains?|stays?|stayed)`

/** What an adjective cannot be followed by and still be a verdict ("strong at", "nice to", …). */
const NOT_DESCRIBING = String.raw`(?! (?:at|for|with|when|on|in|that|to|about|enough|because|since|if|as|from|under|against|during|while|where|after|before|than|compared|relative|by|via|through|across)\b)`
/** After a participle-like word ("polished", "refined"): not an object or a particle ("polished the ui"). */
const NOT_OBJECT = String.raw`(?! (?:the|a|an|our|this|that|these|those|it|them|every|all|each|my|your|their|his|her|its|up|out|down|over|off|in|on|by|for|with|at|until|after|before|during|last|today|yesterday|tonight)\b)`
/** The predicate ends here: end of the clause, or a conjunction or a tail that only adds. */
const CLAUSE_END = String.raw`(?= *(?:$|[.,!?;:]| (?:and|but|so|though|to|enough|too|tbh|honestly|overall|lol|haha|yet|here|today|tonight|already|throughout|everywhere|all (?:the )?way|for sure|by far|in every way)\b))`

/** The adverbs that themselves admire. */
const ADVERB = String.raw`(?:impressively|remarkably|beautifully|elegantly|flawlessly|brilliantly|wonderfully|masterfully|cleverly|ingeniously|expertly|skillfully|skilfully|stunningly|gorgeously|exquisitely|superbly|splendidly|magnificently|marvel?lously|delightfully|immaculately|tastefully|gracefully|artfully|deftly|admirably|commendably|exceptionally|outstandingly|spectacularly|phenomenally|extraordinarily|astonishingly|refreshingly|surprisingly well|insanely well|incredibly well|exceedingly well|unusually well|thoughtfully|professionally|lovingly|painstakingly|meticulously)`

/** Words for the other teams or the room the work is set above. */
const ANYONE = String.raw`(?:(?:all|every|any|the|most|half|nearly all|almost all|each)(?: of)?(?: the)?(?: (?:nearby|other|rival|competing|remaining|neighbou?ring|adjacent|surrounding|next-?door))?(?: (?:teams?|projects?|submissions?|entries|demos?|hacks?|tables?|builds?|products?|apps?|solutions?|contenders?|competitors?|rivals?|peers|rest|others?|field|competition|pack|room|floor|crowd|alternatives|one|ones|thing|things))(?! (?:we|i|they|you|that|which|on|in|from|of|for|with|at|before|used|last|tried|had|use|have|built|made|compared|baseline|baselines|benchmark)\b)|anything|everything|anyone|everyone|everybody|anybody|all(?= *(?:$|[.,!?;:]))|competitors|alternatives|competition|rivals?|peers|other (?:teams?|projects?|submissions?|entries|demos?|hacks?|tables?|builds?|products?|apps?|solutions?)|half the (?:floor|room|field|teams|projects|hackathon)|what(?:'s| is| else is| else was| we've| i've| i have| we have) (?:else )?(?:here|seen|out there|on show|on display|been shown|on the floor))`

/** An evaluative adjective of the work, said as a predicate: "the pitch was confident and sharp". */
const PREDICATE_HEAD = String.raw`(?:${SUBJECT}(?: really| honestly| just| actually| definitely| totally| also| still| clearly| genuinely)?)`

export const BROAD_VERDICT = new RegExp(
    [
        // WORD: words that only ever judge, anywhere.
        String.raw`\b${WORD}\b`,
        ...PHRASE,
        // The work, a copula or a verb of seeming, an intensifier, an evaluative adjective ("the
        // pitch was confident and sharp", "honestly the onboarding was delightful", "the ui
        // feels like …" is PHRASE). A soft word needs an intensifier.
        String.raw`\b${PREDICATE_HEAD} ${COPULA}(?: ${INTENS}){0,2} ${AESTHETIC}\b${CLAUSE_END}`,
        String.raw`\b${PREDICATE_HEAD} ${COPULA}(?: ${INTENS}){0,2} ${SOFT}\b(?= *(?:$|[.,!?;:]| (?:and|but|so|though|too|tbh|honestly|overall|lol|haha|yet)\b))`,
        String.raw`\b${PREDICATE_HEAD} ${COPULA}(?: ${INTENS}){1,2} ${SOFT}\b${NOT_DESCRIBING}`,
        // Anything at all, said to be hard praise ("the hardest part looked effortless", "that
        // search ranking logic was elegant").
        String.raw`\b(?:[\w'-]+ ){1,4}?${COPULA}(?: ${INTENS}){0,2} ${HARD_PRAISE}\b${CLAUSE_END}`,
        // A copula, then an evaluative pair ("clean and polished", "confident and sharp").
        String.raw`\b${COPULA}(?: ${INTENS}){0,2} (?:${AESTHETIC}|${SOFT}) (?:and|but|yet|&|,) (?:${INTENS} )?(?:${AESTHETIC}|${SOFT})\b${NOT_DESCRIBING}`,
        // An intensifier and an evaluative adjective ("very elegant", "so polished", "super
        // impressive"): not "we really polished the ui".
        String.raw`\b${INTENS_ADJ} (?:${AESTHETIC})\b${NOT_OBJECT}`,
        String.raw`\b${INTENS_ADJ} ${SOFT}(?= *(?:$|[.,!?;:])| (?:work|job|demo|app|ui|ux|design|interface|execution|pitch|project|product|build|hack|team|idea|concept|polish|craft)\b)`,
        // An evaluative adjective before the work ("slick interface", "tidy backend", "elegant
        // solution", "polished demo", "slick user experience"), never before an object or a verb's
        // particle ("polished the whole ui").
        String.raw`\b(?:${AESTHETIC})(?: (?:and|&|,|yet|but) (?:${AESTHETIC}|${SOFT}))?(?: (?!(?:the|a|an|our|this|that|every|all|each|those|these|my|your|their|his|her|its)\b)[\w-]+){0,2}? ${WORK}\b`,
        String.raw`\b${SOFT} (?:and|&) (?:${AESTHETIC}) ${WORK}\b|\b${INTENS_ADJ} ${SOFT}(?: [\w-]+)? ${WORK}\b`,
        // An adverb that admires, on anything ("impressively tidy", "elegantly handles").
        String.raw`\b${ADVERB}\b`,
        // Set above the room ("better than anything else here", "outshines the other
        // submissions", "far superior to alternatives", "our code is cleaner than anything here").
        String.raw`\b(?:better|stronger|smarter|cleaner|slicker|sharper|smoother|superior|more (?:polished|impressive|elegant|complete|refined|thoughtful|innovative|creative|robust|scalable|ambitious|useful|compelling|capable|advanced|sophisticated|reliable|powerful|accurate|intuitive|delightful|stable|mature|professional))(?: (?:and|or) [a-z]+er)? (?:than|of|to) ${ANYONE}\b`,
        String.raw`\b(?:(?:far|way|miles|streets|light ?years|worlds|leagues|well|clearly|head and shoulders) )?(?:above|ahead of|beyond|past|ahead|superior to) ${ANYONE}\b`,
        String.raw`\b(?:out(?:shin|class|perform|do|rank|sell|play|pac|stripp|match|smart|dazzl)\w*|eclipse[sd]?|eclipsing|dwarf(?:s|ed|ing)?|tower(?:s|ed|ing)? over|trounc\w+|surpass\w*|trump\w*|top(?:s|ped)?|beat(?:s|ing)?|edg(?:e|es|ed|ing) out|blow(?:s|n)?|blew|(?:rank|rate|score)(?:s|d)? (?:above|over|ahead of|higher than)|(?:run|runs|ran|running) circles around|stand(?:s|ing)? out (?:among|from|against|amid)|(?:leave|leaves|left|leaving) \w+(?: \w+){0,3}? in the dust) ${ANYONE}(?: away| behind)?\b`,
        String.raw`\b(?:leave|leaves|left|leaving) ${ANYONE} (?:behind|in the dust|in the rearview)\b`,
        String.raw`\b(?:no|not a single|none of the) (?:other )?(?:team|project|submission|entry|demo|hack|table|product|app|solution|others?)(?: here| in the room| at this hackathon| today| tonight)? (?:comes close|compares|can compare|matches|can match|touches|rivals|can touch|beats|can beat)\b`,
        String.raw`\b(?:none|nobody|no ?one|no other) (?:of the others |else |here )?(?:comes close|compares|can compare|matches|can match|touches|rivals|can touch|beats|can beat|even comes close|else compares)\b`,
        String.raw`\b(?:max(?:imum)?|full|top|highest|perfect) (?:points|score|scores|marks|rating|ratings|stars|grade)\b`,
        String.raw`\b(?:clearly|obviously|easily|hands down|definitely|by far|without a doubt|no doubt|undoubtedly|undeniably|arguably|absolutely) (?:the )?(?:front[- ]?runner|leader|favou?rite|champion|winner|finest|best|top|number one|#1|one to beat|one to watch)\b`,
        // The best of a scope, as a noun phrase ("the cleanest code in the whole hackathon", "the
        // slickest ui at this expo").
        String.raw`\b(?:the )?(?:best|cleanest|slickest|sharpest|smartest|coolest|prettiest|nicest|greatest|finest|strongest|neatest|tightest|most (?:polished|impressive|elegant|beautiful|creative|innovative|ambitious|thoughtful|complete|refined|original|clever|stunning|incredible|amazing|awesome|delightful|professional)) [\w'-]+(?: [\w'-]+){0,3}? (?:in|of|at|on|from) (?:the |this )(?:whole |entire |all |very )?(?:of )?(?:hackathon|room|building|show|event|expo|hall|competition|field|track|category|lot|bunch|venue|weekend|night|day|floor|place|table|row|list|crowd)\b`,
        String.raw`\b(?:the )?(?:best|cleanest|slickest|sharpest|smartest|coolest|prettiest|nicest|greatest|finest|strongest|neatest|tightest) (?:app|apps|product|products|solution|build|ui|ux|interface|design|experience|prototype|implementation|engineering|execution|pitch|presentation|demo|project|hack|idea|code|codebase|backend|frontend|stack)(?: ever| yet| around| i've seen| we've seen| of all)?(?= *(?:$|[.,!?;:])| (?:here|ever|yet|so far|today|tonight|around|out there|of all|i've|we've|you've|in the world)\b)`,
        // First-person claims to the superlative ("we built the most impactful solution", "we have
        // the strongest technical foundation", "our approach is the most scalable").
        String.raw`\b(?:we|ours|they|our [\w-]+(?: [\w-]+)?|this|it)(?:'ve| have| has| got| own| had| built| made| delivered| created| shipped| is| are| was|'s|'re)(?: (?:easily|clearly|simply|honestly|just|truly|probably|definitely|literally|by far|hands down|arguably|quite|got|built|made|delivered))* (?:the )?(?:most (?!(?:of|people|users|students|farmers|teachers|patients|time|common|popular|requested|recent|likely|used|frequent)\b)[a-z]+|best|finest|smartest|strongest|cleanest|greatest|slickest|sharpest|coolest|prettiest|nicest|boldest|richest|cleverest|tightest|only (?:real |true |truly |genuine )?(?:solution|answer|contender|option|product|team|project|entry|app))(?: [\w'-]+){0,2}?(?= *(?:$|[.,!?;:])| (?:solution|product|app|project|entry|submission|build|hack|demo|pitch|idea|tool|platform|prototype|implementation|interface|ui|ux|design|experience|architecture|team|stack|codebase|foundation|approach|system|execution|presentation|work|thing|here|so far|today|tonight|ever|yet|around|out there)\b)`,
        String.raw`\b(?:we|they|ours)(?: (?:absolutely|totally|completely|easily|just|really|all|literally|single-?handedly))* (?:nailed|crushed|killed|smashed|aced|mastered|dominated|conquered|owned|rocked|slayed|destroyed|obliterated|demolished|dominate|crush|own|rock|slay) (?:it|this|that|the (?:brief|assignment|challenge|task|category|categories|track|prompt|hackathon|competition|room|show|requirements?|spec|rubric|criteria|judging|market|space|industry)|every(?:thing| single| last)? [\w-]+|all(?: of)?(?: the)? [\w-]+|this (?:category|track|hackathon|competition))\b`,
        String.raw`\b(?:nailed|crushed|killed|smashed|aced|rocked|slayed|stuck the landing on) (?:the |this |that |every |all |our |their )(?:whole |entire |single |last )?(?:flow|thing|demo|pitch|presentation|brief|day|night|show|round|judging|landing|requirements?|ui|ux|design|onboarding|execution|launch|delivery|assignment|requirement)\b`,
        String.raw`\b(?:nail|execut|solv|deliver|master|complet|pull|achiev|accomplish|handl|ship|built|implement)\w*(?: [\w'-]+){0,6}? (?:perfectly|flawlessly|impeccably|beyond expectations)\b`,
        String.raw`\b(?:is|are|was|were|'s|'re) (?:far |clearly |simply |objectively |vastly |way |much |significantly |hands down |easily )*(?:superior|supreme|unbeaten|undefeated|untouchable|the best|the greatest|the winner)(?= *(?:$|[.,!?;:]|and\b|but\b|so\b|here\b|overall\b|by far\b|hands down\b))`,
        String.raw`\b(?:is|are|was|were|'s|'re) (?:far|clearly|simply|objectively|vastly|way|much|significantly|hands down|easily) (?:better|smarter|stronger|cleaner|slicker|sharper|smoother|more (?:polished|impressive|elegant|complete|refined|useful|capable|ambitious|innovative|creative))\b`,
        String.raw`\b(?:we|they|ours|this team|the team) (?:delivered|deliver|exceeded|exceed|surpassed|surpass|outdid|outdo) (?:beyond |all |every |the )?(?:expectations?|requirements?|brief|spec)\b`,
        // The judge's own invitation to others ("you should really try that demo").
        String.raw`\b(?:you|everyone|everybody|y'all|folks) (?:should|must|have to|need to|gotta|ought to) (?:really |definitely |absolutely )?(?:see|try|check out|look at|watch|experience|visit|go to) (?:this|that|their|our|the) (?:demo|project|app|table|hack|build|team|booth|prototype)\b`,
    ].join("|"),
    "i",
)

/**
 * Words a bare evaluation may be made of besides evaluative ones: intensifiers, a copula, a
 * pronoun, an article, and the nouns for the work. "very strong", "clean and polished", "slick
 * interface", "this is super impressive".
 */
const BARE_FILLER = new RegExp(
    `^(?:${INTENS}|it|its|it's|this|that|that's|thats|is|are|was|were|be|a|an|the|and|but|yet|or|wow|whoa|oh|yeah|yes|honestly|literally|seriously|ok|okay|man|dude|guys|we|they|you|so|too|as|of|to|use|work|job|done|team|great|good|really|all|ours|our|their|your|my|i|i'd|i'm|id|im|say|think|feel|found|find|looked|looks|look|feels|feel|seems|seem|here|there|ever|in|class|for|sure|though|right|like|get|got|just|mobile|web|user|interaction|visual|overall|whole|little|tiny|small)$`,
    "i",
)
const BARE_EVAL = new RegExp(
    `^(?:${AESTHETIC}|${SOFT}|${WORD}|${WORK}|well|best|better|top|number|one)$`,
    "i",
)
const BARE_STRONG = new RegExp(`^(?:${AESTHETIC}|${WORD})$`, "i")
const BARE_WORK = new RegExp(`^${WORK}$`, "i")
const BARE_INTENS = new RegExp(`^${INTENS}$`, "i")
const BARE_SOFT = new RegExp(`^${SOFT}$`, "i")

/**
 * A clause that is nothing but an evaluation ("very strong", "clean and polished", "slick
 * interface", "super impressive honestly"): up to six words, every one an evaluative adjective, an
 * intensifier, a filler or a name for the work, and at least one of them evaluative. A soft word
 * (strong, clean, smooth) needs an intensifier, a second evaluative word or a project noun to
 * count, so "clean" or "strong" on their own are not read as a verdict.
 */
export function isBareEvaluation(clause: string): boolean {
    const words = clause
        .toLowerCase()
        .replace(/[^a-z0-9'\- ]+/g, " ")
        .replace(/\bwell (\w+)/g, "well-$1")
        .split(/\s+/)
        .filter(Boolean)
    if (!words.length || words.length > 6) return false
    // "we polished the ui", "they refined it": a subject and a past-tense verb is not an evaluation.
    if (
        /^(?:we|i|they|you|he|she|it)$/.test(words[0]) &&
        /ed$/.test(words[1] ?? "")
    )
        return false
    // A participle with its object after it is a verb ("our team polished the ui", "the team
    // refined the pipeline"), whoever the subject is.
    const OBJECT_AFTER =
        /^(?:the|a|an|our|their|this|that|these|those|it|them|its|my|your|his|her|every|all|each)$/
    for (let i = 0; i < words.length - 1; i++)
        if (
            /ed$/.test(words[i]) &&
            BARE_STRONG.test(words[i]) &&
            OBJECT_AFTER.test(words[i + 1])
        )
            return false
    let strong = 0
    let soft = 0
    let intens = 0
    let work = 0
    for (const w of words) {
        const isFiller = BARE_FILLER.test(w)
        if (!isFiller && !BARE_EVAL.test(w)) return false
        if (BARE_STRONG.test(w)) strong++
        else if (BARE_SOFT.test(w)) soft++
        else if (BARE_WORK.test(w)) work++
        if (BARE_INTENS.test(w)) intens++
    }
    return strong > 0 || (soft > 0 && (intens > 0 || work > 0 || soft > 1))
}
