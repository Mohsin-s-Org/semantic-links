import type { LexicalDocumentInput } from "../lexical/types.ts";

export type EvaluationCategory =
  | "exact-title"
  | "alias"
  | "heading"
  | "semantic-only"
  | "ambiguous"
  | "mixed-language";

export interface EvaluationFixture {
  id: string;
  category: EvaluationCategory;
  language: "en" | "ar" | "mixed";
  anchorText: string;
  contextText: string;
  relevantTargets: readonly string[];
  exactTarget: string | null;
}

export interface EvaluationCorpus {
  documents: readonly LexicalDocumentInput[];
  fixtures: readonly EvaluationFixture[];
}

interface Seed {
  slug: string;
  title: string;
  arabicTitle: string;
  alias: string;
  heading: string;
  englishBody: string;
  arabicBody: string;
  semanticEnglish: string;
  semanticArabic: string;
  mixedQuery: string;
  ambiguousQuery: string;
}

const SEEDS: readonly Seed[] = [
  {
    slug: "water-cycle",
    title: "Water Cycle",
    arabicTitle: "دورة الماء",
    alias: "Hydrologic Cycle",
    heading: "Evaporation and Rainfall",
    englishBody: "Heat lifts moisture from oceans and soil. Vapour cools into clouds before precipitation returns water to the ground.",
    arabicBody: "ترفع الحرارة الرطوبة من البحار والتربة ثم يبرد البخار فيتكوّن السحاب ويعود الماء إلى الأرض بالمطر.",
    semanticEnglish: "how moisture rises, forms clouds, and comes back as rain",
    semanticArabic: "كيف تصعد الرطوبة ثم تتكون السحب ويعود المطر",
    mixedQuery: "clouds تتكوّن بعد صعود بخار البحر",
    ambiguousQuery: "continuous circulation through the environment"
  },
  {
    slug: "photosynthesis",
    title: "Photosynthesis",
    arabicTitle: "البناء الضوئي",
    alias: "Plant Light Conversion",
    heading: "Light, Carbon Dioxide and Sugar",
    englishBody: "Green plants use light energy to combine carbon dioxide and water into sugars while releasing oxygen.",
    arabicBody: "تستخدم النباتات الخضراء طاقة الضوء لتحويل الماء وثاني أكسيد الكربون إلى سكريات وتطلق الأكسجين.",
    semanticEnglish: "plants storing sunlight as chemical food",
    semanticArabic: "كيف تخزن النباتات ضوء الشمس في صورة غذاء",
    mixedQuery: "plants تصنع الغذاء باستخدام الضوء",
    ambiguousQuery: "energy conversion inside living cells"
  },
  {
    slug: "gravity",
    title: "Gravity",
    arabicTitle: "الجاذبية",
    alias: "Gravitational Attraction",
    heading: "Mass and Distance",
    englishBody: "Objects with mass attract one another. The attraction grows with mass and weakens as separation increases.",
    arabicBody: "تتجاذب الأجسام ذات الكتلة وتزداد القوة بزيادة الكتلة وتضعف كلما زادت المسافة.",
    semanticEnglish: "why bodies fall and planets remain in orbit",
    semanticArabic: "لماذا تسقط الأجسام وتبقى الكواكب في مداراتها",
    mixedQuery: "planets تبقى في المدار بسبب قوة جذب",
    ambiguousQuery: "a force acting across space"
  },
  {
    slug: "memory",
    title: "Human Memory",
    arabicTitle: "الذاكرة البشرية",
    alias: "Remembering and Recall",
    heading: "Encoding, Storage and Retrieval",
    englishBody: "Remembering depends on encoding experience, retaining it, and retrieving it when a cue makes the stored pattern accessible.",
    arabicBody: "يعتمد التذكر على ترميز الخبرة وحفظها ثم استرجاعها عندما يظهر دليل مناسب.",
    semanticEnglish: "why a familiar smell can bring back an old event",
    semanticArabic: "كيف تعيد رائحة مألوفة حدثا قديما إلى الذهن",
    mixedQuery: "a cue يساعد على استرجاع تجربة قديمة",
    ambiguousQuery: "retaining information over time"
  },
  {
    slug: "trade",
    title: "Trade and Exchange",
    arabicTitle: "التجارة والتبادل",
    alias: "Market Exchange",
    heading: "Specialisation and Mutual Benefit",
    englishBody: "Exchange allows people to specialise and trade surplus output for goods that others can produce more efficiently.",
    arabicBody: "يسمح التبادل للناس بالتخصص ومبادلة الفائض بسلع ينتجها الآخرون بكفاءة أكبر.",
    semanticEnglish: "both sides gaining by swapping what each produces best",
    semanticArabic: "استفادة الطرفين من مبادلة ما يتقن كل منهما إنتاجه",
    mixedQuery: "specialisation تجعل exchange مفيدا للطرفين",
    ambiguousQuery: "cooperation through voluntary transfer"
  },
  {
    slug: "justice",
    title: "Justice",
    arabicTitle: "العدل",
    alias: "Fair Treatment",
    heading: "Rights, Duties and Proportion",
    englishBody: "Justice concerns giving people their due, applying rules consistently, and correcting unfair advantage or harm.",
    arabicBody: "يتعلق العدل بإعطاء كل ذي حق حقه وتطبيق القواعد بثبات وإزالة الظلم والضرر.",
    semanticEnglish: "treating comparable cases alike while repairing unfair harm",
    semanticArabic: "معاملة الحالات المتشابهة بالتساوي ورفع الضرر الظالم",
    mixedQuery: "rules تطبق بلا محاباة مع رد الحقوق",
    ambiguousQuery: "a principle for deciding what people deserve"
  },
  {
    slug: "patience",
    title: "Patience",
    arabicTitle: "الصبر",
    alias: "Steadfastness",
    heading: "Endurance Without Passivity",
    englishBody: "Patience is sustained self-control during difficulty while continuing appropriate effort rather than surrendering to impulse.",
    arabicBody: "الصبر ضبط للنفس عند الشدة مع الاستمرار في العمل المناسب دون استسلام للاندفاع.",
    semanticEnglish: "remaining steady under pressure without giving up useful action",
    semanticArabic: "الثبات عند الشدة مع مواصلة العمل النافع",
    mixedQuery: "steady عند الشدة دون ترك العمل",
    ambiguousQuery: "maintaining direction despite discomfort"
  },
  {
    slug: "charity",
    title: "Charity",
    arabicTitle: "الصدقة",
    alias: "Voluntary Giving",
    heading: "Giving, Need and Dignity",
    englishBody: "Charitable giving directs resources toward need while protecting dignity and avoiding unnecessary dependence or humiliation.",
    arabicBody: "توجه الصدقة الموارد إلى المحتاج مع حفظ الكرامة وتجنب الإذلال أو الاعتماد غير الضروري.",
    semanticEnglish: "supporting someone in need while preserving their dignity",
    semanticArabic: "مساعدة المحتاج مع حفظ كرامته",
    mixedQuery: "giving للمحتاج بطريقة تحفظ dignity",
    ambiguousQuery: "transferring resources for another person's welfare"
  },
  {
    slug: "migration",
    title: "Migration",
    arabicTitle: "الهجرة",
    alias: "Population Movement",
    heading: "Push and Pull Factors",
    englishBody: "People relocate because pressures drive them away from one place while opportunities, safety, or family draw them toward another.",
    arabicBody: "ينتقل الناس لأن ضغوطا تدفعهم من مكان بينما تجذبهم فرص أو سلامة أو أسرة إلى مكان آخر.",
    semanticEnglish: "leaving one region because danger pushes while opportunity attracts elsewhere",
    semanticArabic: "مغادرة منطقة بسبب الخطر والانتقال إلى مكان تجذب إليه الفرص",
    mixedQuery: "danger يدفع الناس وopportunity تجذبهم لمكان آخر",
    ambiguousQuery: "movement from one place to another over time"
  },
  {
    slug: "language",
    title: "Language and Meaning",
    arabicTitle: "اللغة والمعنى",
    alias: "Linguistic Communication",
    heading: "Symbols, Context and Interpretation",
    englishBody: "Language links conventional signs with shared concepts, but context and speaker intention shape how an expression is understood.",
    arabicBody: "تربط اللغة الرموز المتعارف عليها بالمعاني المشتركة لكن السياق وقصد المتكلم يؤثران في الفهم.",
    semanticEnglish: "the same words conveying different ideas when the situation changes",
    semanticArabic: "تغير معنى الكلمات نفسها عندما يتغير السياق",
    mixedQuery: "context يغير معنى العبارة نفسها",
    ambiguousQuery: "a system that carries ideas between minds"
  },
  {
    slug: "ecosystem",
    title: "Ecosystems",
    arabicTitle: "النظم البيئية",
    alias: "Ecological Networks",
    heading: "Organisms, Resources and Feedback",
    englishBody: "An ecosystem consists of organisms and physical conditions connected by food, energy flow, competition, and recycling of materials.",
    arabicBody: "يتكون النظام البيئي من كائنات وظروف مادية تربطها علاقات الغذاء والطاقة والتنافس وإعادة تدوير المواد.",
    semanticEnglish: "living communities connected through food, resources, and their surroundings",
    semanticArabic: "مجتمعات حية مترابطة بالغذاء والموارد والبيئة المحيطة",
    mixedQuery: "organisms مترابطة بالغذاء والموارد والبيئة",
    ambiguousQuery: "many interacting parts maintaining a larger whole"
  },
  {
    slug: "electricity",
    title: "Electric Circuits",
    arabicTitle: "الدوائر الكهربائية",
    alias: "Current and Voltage",
    heading: "Closed Paths and Resistance",
    englishBody: "Electric current flows when a voltage source drives charge through a closed conducting path whose resistance limits the flow.",
    arabicBody: "يسري التيار عندما يدفع فرق الجهد الشحنة في مسار موصل مغلق وتحد المقاومة من مقدار السريان.",
    semanticEnglish: "charge moving only when there is a complete conducting loop",
    semanticArabic: "حركة الشحنة عندما يكتمل المسار الموصل",
    mixedQuery: "current يسري في loop موصل مغلق",
    ambiguousQuery: "flow caused by a difference in potential"
  },
  {
    slug: "prayer",
    title: "Prayer",
    arabicTitle: "الصلاة",
    alias: "Ritual Worship",
    heading: "Attention, Remembrance and Discipline",
    englishBody: "Regular prayer combines remembrance, bodily discipline, recitation, and focused intention at appointed times.",
    arabicBody: "تجمع الصلاة المنتظمة بين الذكر والانضباط البدني والقراءة والنية المركزة في أوقات محددة.",
    semanticEnglish: "repeated worship at fixed times that trains attention and remembrance",
    semanticArabic: "عبادة متكررة في أوقات معلومة تدرب على الذكر والانتباه",
    mixedQuery: "worship في أوقات محددة يقوي الذكر والانضباط",
    ambiguousQuery: "a repeated practice that directs attention beyond the self"
  },
  {
    slug: "fasting",
    title: "Fasting",
    arabicTitle: "الصيام",
    alias: "Abstention for Worship",
    heading: "Restraint, Intention and Time",
    englishBody: "Fasting is deliberate abstention for a defined period, joining bodily restraint with intention, reflection, and ethical conduct.",
    arabicBody: "الصيام امتناع مقصود لمدة محددة يجمع ضبط الجسد بالنية والتفكر وحسن السلوك.",
    semanticEnglish: "temporarily refusing permitted appetites to train self-control and intention",
    semanticArabic: "ترك الشهوات المباحة مدة معينة لتدريب النفس والنية",
    mixedQuery: "abstention المؤقت يدرب النفس على self-control",
    ambiguousQuery: "voluntary restraint for a larger purpose"
  },
  {
    slug: "sleep",
    title: "Sleep",
    arabicTitle: "النوم",
    alias: "Rest and Circadian Rhythm",
    heading: "Cycles, Recovery and Memory",
    englishBody: "Sleep follows biological rhythms and supports physical recovery, attention, emotional regulation, and consolidation of learning.",
    arabicBody: "يتبع النوم إيقاعات حيوية ويدعم تعافي الجسد والانتباه وتنظيم المشاعر وتثبيت التعلم.",
    semanticEnglish: "nightly rest helping the brain stabilise newly learned information",
    semanticArabic: "راحة الليل تساعد الدماغ على تثبيت المعلومات الجديدة",
    mixedQuery: "nightly rest يساعد على تثبيت learning الجديدة",
    ambiguousQuery: "a recurring state that restores performance"
  },
  {
    slug: "abstraction",
    title: "Software Abstraction",
    arabicTitle: "التجريد البرمجي",
    alias: "Information Hiding",
    heading: "Interfaces and Implementation",
    englishBody: "Abstraction exposes a stable interface while hiding lower-level implementation details so callers depend on behaviour rather than machinery.",
    arabicBody: "يعرض التجريد واجهة مستقرة ويخفي تفاصيل التنفيذ حتى يعتمد المستخدم على السلوك لا على الآلية الداخلية.",
    semanticEnglish: "using a simple contract without needing to know the machinery underneath",
    semanticArabic: "استخدام عقد بسيط دون معرفة الآلية الداخلية",
    mixedQuery: "a stable interface تخفي implementation details",
    ambiguousQuery: "reducing complexity by exposing only what is needed"
  }
];

export function createEvaluationCorpus(): EvaluationCorpus {
  const documents = SEEDS.map(toDocument);
  const fixtures = SEEDS.flatMap((seed, index) => {
    const target = pathOf(seed);
    const neighbour = pathOf(SEEDS[(index + 1) % SEEDS.length] ?? seed);
    return [
      fixture(seed, "exact-title", "en", seed.title, "", [target], target),
      fixture(seed, "alias", "en", seed.alias, "", [target], target),
      fixture(seed, "heading", "en", seed.heading, "", [target], target),
      fixture(seed, "semantic-only", "en", seed.semanticEnglish, seed.semanticEnglish, [target], null),
      fixture(seed, "semantic-only", "ar", seed.semanticArabic, seed.semanticArabic, [target], null),
      fixture(seed, "mixed-language", "mixed", seed.mixedQuery, seed.mixedQuery, [target], null),
      fixture(seed, "ambiguous", "en", seed.ambiguousQuery, seed.ambiguousQuery, [target, neighbour], null)
    ];
  });
  return { documents, fixtures };
}

function fixture(
  seed: Seed,
  category: EvaluationCategory,
  language: "en" | "ar" | "mixed",
  anchorText: string,
  contextText: string,
  relevantTargets: readonly string[],
  exactTarget: string | null
): EvaluationFixture {
  return {
    id: `${seed.slug}-${category}-${language}`,
    category,
    language,
    anchorText,
    contextText,
    relevantTargets,
    exactTarget
  };
}

function toDocument(seed: Seed): LexicalDocumentInput {
  return {
    path: pathOf(seed),
    title: seed.title,
    basename: seed.title,
    aliases: [seed.alias, seed.arabicTitle],
    headings: [{ text: seed.heading, level: 2 }],
    tags: [],
    body: `${seed.englishBody}\n${seed.arabicBody}`
  };
}

function pathOf(seed: Seed): string {
  return `evaluation/${seed.slug}.md`;
}
