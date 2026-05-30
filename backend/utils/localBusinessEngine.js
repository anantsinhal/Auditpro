'use strict';


const HIGH_VALUE_INTENTS = [
  'near me', 'best', 'top rated', 'open now', 'delivery', 'takeaway',
  'dine in', 'family friendly', 'romantic', 'cheap', 'affordable',
  'authentic', 'vegan', 'vegetarian', 'gluten free', 'halal', 'organic'
];

const CUISINE_KEYWORDS = {
  italian: ['italian restaurant', 'pizza', 'pasta', 'risotto', 'tiramisu'],
  indian: ['indian restaurant', 'curry', 'biryani', 'tandoori', 'dal', 'naan'],
  chinese: ['chinese restaurant', 'dim sum', 'noodles', 'stir fry', 'spring rolls'],
  mexican: ['mexican restaurant', 'tacos', 'burritos', 'guacamole', 'quesadilla'],
  japanese: ['japanese restaurant', 'sushi', 'ramen', 'tempura', 'sashimi'],
  american: ['burger', 'bbq', 'steakhouse', 'wings', 'fries'],
  cafe: ['cafe', 'coffee shop', 'brunch', 'specialty coffee', 'pastries'],
  mediterranean: ['mediterranean restaurant', 'hummus', 'falafel', 'shawarma'],
  thai: ['thai restaurant', 'pad thai', 'green curry', 'tom yum', 'mango sticky rice'],
  french: ['french restaurant', 'croissant', 'brasserie', 'crepes', 'soufflé'],
  generic: ['restaurant', 'food', 'dining', 'lunch', 'dinner', 'breakfast']
};

const TREND_ITEMS = {
  highMargin: [
    { name: 'Signature Mocktail Flight', description: 'A trio of house-crafted zero-proof cocktails — vibrant, photogenic, and priced at a premium with ~80% margin.', margin: 'Very High' },
    { name: 'Smash Burger (house special)', description: 'Double-smashed patty with compound butter, caramelised onion jam, aged cheddar and brioche bun. Low food cost, high perceived value.', margin: 'High' },
    { name: 'Chef\'s Tasting Board', description: 'Rotating selection of chef\'s picks — dips, cured meats, seasonal pickles. Uses surplus kitchen prep; commands a premium price.', margin: 'High' },
    { name: 'Loaded Fries (signature topping)', description: 'Crispy fries topped with pulled protein, cheese sauce, jalapeños and sour cream. Extremely low cost, shareable, and sells at 4x food cost.', margin: 'Very High' },
    { name: 'Affogato Dessert', description: 'Single scoop of vanilla gelato drowned in a double espresso shot. Minimal prep, uses existing coffee infrastructure, very high margin.', margin: 'Very High' }
  ],
  instagrammable: [
    { name: 'Cloud Dalgona Latte', description: 'Whipped coffee foam layered over iced milk — TikTok-viral drink that drives shares and discovery on social media.', socialAngle: 'Drink trend, highly photographable' },
    { name: 'Rainbow Açaí Bowl', description: 'Layered açaí base topped with colourful seasonal fruits, granola, and edible flowers. Drives Instagram posts organically.', socialAngle: 'Colour-forward, health-positioned' },
    { name: 'Towering Freakshake', description: 'Over-the-top milkshake with toppings piled high. Classic viral moment — customers photograph and post before drinking.', socialAngle: 'Pure virality' }
  ],
  trendy: [
    { name: 'Birria Tacos with Consommé', description: 'Slow-braised beef in ancho-guajillo consommé, served with dipping broth. The most searched food item on TikTok.', trend: 'Viral TikTok food' },
    { name: 'Korean Corn Dog', description: 'Batter-coated hot dog with stretchy mozzarella, fried crispy, rolled in sugar. Perfect street-food add-on for young audiences.', trend: 'K-food trend' },
    { name: 'Smoked Butter Chicken', description: 'Butter chicken finished with a table-side smoke cloche. Elevated comfort food — interactive and shareable.', trend: 'Elevated comfort food' },
    { name: 'Miso Caramel Burnt Cheesecake', description: 'Japanese-inspired burnt Basque cheesecake with miso caramel drizzle. Bakery-style dessert trending across food blogs.', trend: 'Fusion dessert trend' },
    { name: 'Build-Your-Own Bowl', description: 'Grain base + protein + sauce combinations chosen by the customer. Caters to dietary preferences and health-conscious diners.', trend: 'Customisation & health' }
  ]
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectCuisine(text = '') {
  const lower = text.toLowerCase();
  for (const [cuisine, keywords] of Object.entries(CUISINE_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return cuisine;
  }
  return 'generic';
}

function titleCase(str) {
  return String(str).replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.substr(1).toLowerCase());
}

function scoreFromRating(rating) {
  if (!rating || isNaN(Number(rating))) return 0;
  return Math.round((Number(rating) / 5) * 100);
}

function parseReviews(rawText = '') {
  if (!rawText || !rawText.trim()) return [];
  return rawText.split(/\n{2,}|---+/).map(r => r.trim()).filter(r => r.length > 20);
}

function analyseReviewSentiment(reviewsText = '') {
  const reviews = parseReviews(reviewsText);
  if (reviews.length === 0) return null;

  const POSITIVE_SIGNALS = ['great', 'excellent', 'amazing', 'love', 'best', 'delicious', 'fantastic', 'wonderful', 'perfect', 'fresh', 'friendly', 'fast', 'clean', 'cozy', 'recommend', 'staff', 'service', 'value', 'atmosphere', 'tasty', 'yummy', 'good', 'nice'];
  const NEGATIVE_SIGNALS = ['slow', 'cold', 'bad', 'terrible', 'worst', 'rude', 'wait', 'waited', 'expensive', 'small', 'noisy', 'dirty', 'wrong', 'disappointing', 'overpriced', 'average', 'undercooked', 'overcooked', 'bland', 'salty', 'poor', 'mediocre', 'parking', 'crowded', 'loud', 'late', 'missing'];

  const praisedAspects = {};
  const complainedAspects = {};

  for (const review of reviews) {
    const lower = review.toLowerCase();
    for (const kw of POSITIVE_SIGNALS) {
      if (lower.includes(kw)) praisedAspects[kw] = (praisedAspects[kw] || 0) + 1;
    }
    for (const kw of NEGATIVE_SIGNALS) {
      if (lower.includes(kw)) complainedAspects[kw] = (complainedAspects[kw] || 0) + 1;
    }
  }

  const topPraised = Object.entries(praisedAspects).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
  const topComplaints = Object.entries(complainedAspects).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);

  return { reviews, topPraised, topComplaints };
}

function buildOperationalImprovements(topComplaints = []) {
  const map = {
    slow:        'Implement kitchen display systems (KDS) and set a 20-minute table-service target. Alert kitchen staff when tickets exceed 15 minutes.',
    cold:        'Audit plate-holding equipment. Pre-warm plates before service. Review pass-to-table time — target under 3 minutes.',
    rude:        'Institute 30-minute monthly staff service briefings. Create a clear escalation path for customer complaints. Recognise staff who receive positive name mentions in reviews.',
    wait:        'Introduce a digital waitlist (e.g., Waitwhile) and send estimated wait times via SMS. Add a bar/snack menu for waiting customers.',
    waited:      'Introduce a digital waitlist (e.g., Waitwhile) and send estimated wait times via SMS.',
    expensive:   'Introduce a lunch deal, happy hour, or value combo meal priced 20–30% below your average main. Communicate value via menu descriptions ("feeds 2", "best seller").',
    overpriced:  'Add a "chef\'s value menu" or early bird discount. Ensure menu descriptions justify pricing with origin stories, quality cues, and portion sizes.',
    dirty:       'Implement visible cleaning checklists at tables and washrooms. Schedule mid-service cleaning sprints. Consider a live cleanliness rating badge on Google Business Profile.',
    parking:     'Add parking information to your Google Business Profile and website. Partner with nearby parking lots for validated parking.',
    noisy:       'Assess acoustic treatment options: soft furnishings, wall panels, ceiling baffles. Consider designated quiet seating zones.',
    loud:        'Same as noisy — address with acoustic materials and volume-controlled background music.',
    bland:       'Review seasoning standards across signature dishes. Conduct monthly blind tasting with kitchen team. Gather specific dish feedback via table QR code surveys.',
    wrong:       'Standardise order-taking: repeat orders back, use POS digital tickets, train servers on allergen awareness.',
    missing:     'Implement a pre-shift briefing on "86" (sold-out) items. Update menu specials board in real time.'
  };
  return topComplaints.map(c => map[c] || `Address "${c}" mentions by reviewing the relevant service or product standard.`).filter(Boolean);
}

function generateNegativeResponse(complaint = 'service issue') {
  return [
    {
      scenario: `Response to negative review mentioning: ${complaint}`,
      response: `Thank you for taking the time to share your feedback — we genuinely appreciate it. We're sorry to hear that your experience fell short of what you deserved. ${titleCase(complaint)} is something we take very seriously, and this is not the standard we hold ourselves to. Our team has already been made aware and we are taking immediate steps to address this. We'd love the opportunity to make it right — please reach out to us directly at [email/phone] so we can welcome you back with a much better experience. We value your feedback and your patronage.`
    },
    {
      scenario: `Response to negative review (general disappointment)`,
      response: `We're truly sorry your visit didn't meet expectations. Every guest deserves a wonderful experience, and clearly we missed the mark on this occasion. We've shared your feedback with our team and management as a priority. If you're open to it, please contact us at [email/phone] — we would genuinely like to understand what happened and make it up to you. Thank you for giving us the chance to improve.`
    }
  ];
}

function generatePositiveResponse(praiseAspect = 'experience') {
  return [
    {
      scenario: `Response to positive review praising: ${praiseAspect}`,
      response: `Wow — thank you so much for this wonderful review! It genuinely means the world to our entire team. We pour so much love and effort into every ${praiseAspect === 'food' ? 'dish' : 'detail'}, and hearing that it made your visit special is the best possible reward. We can't wait to welcome you back very soon! 😊`
    },
    {
      scenario: `Response to positive review (general 5-star praise)`,
      response: `This made our whole team's day — thank you for the kind words! Reviews like yours remind us exactly why we do what we do. We look forward to seeing you again soon and hope every visit keeps up to this standard. You're always welcome here! 🙌`
    }
  ];
}

// ── PART 1 – Local SEO Analysis ───────────────────────────────────────────────

function analyseLocalSEO(data) {
  const { url, city, metaTags = {}, headings = {}, wordCount = 0, pageSpeed = 'unknown', googleRating, reviewCount } = data;
  const cuisine = detectCuisine([metaTags.title, metaTags.description, headings.h1, data.menuItems].join(' '));
  const cityLower = (city || '').toLowerCase().trim();
  const cityTitle = titleCase(city || 'your city');

  const missingKeywords = [];
  const issues = [];
  const improvements = [];

  // Title analysis
  const title = metaTags.title || '';
  const hasCityInTitle = title.toLowerCase().includes(cityLower);
  const hasCuisineInTitle = cuisine !== 'generic' && title.toLowerCase().includes(cuisine);
  const titleLength = title.length;
  let titleScore = 100;

  if (!title) { issues.push({ issue: 'Missing title tag', impact: 'High', category: 'Title Tag' }); titleScore -= 30; }
  else {
    if (!hasCityInTitle) { issues.push({ issue: `City name "${cityTitle}" not in title tag`, impact: 'High', category: 'Title Tag' }); titleScore -= 20; }
    if (titleLength > 60) { issues.push({ issue: `Title too long (${titleLength} chars) — gets cut off in Google`, impact: 'Medium', category: 'Title Tag' }); titleScore -= 10; }
    if (titleLength < 30 && title) { issues.push({ issue: `Title too short (${titleLength} chars) — missing keyword opportunity`, impact: 'Medium', category: 'Title Tag' }); titleScore -= 10; }
  }

  // Meta description
  const desc = metaTags.description || '';
  if (!desc) { issues.push({ issue: 'Missing meta description — Google writes its own, often poorly', impact: 'High', category: 'Meta Description' }); }
  else if (desc.length < 120) { issues.push({ issue: `Meta description too short (${desc.length} chars)`, impact: 'Medium', category: 'Meta Description' }); }
  else if (desc.length > 160) { issues.push({ issue: `Meta description too long (${desc.length} chars) — gets truncated`, impact: 'Low', category: 'Meta Description' }); }

  // H1
  const h1 = headings.h1 || '';
  if (!h1) { issues.push({ issue: 'No H1 heading detected on homepage — critical for local relevance', impact: 'High', category: 'Headings' }); }
  else if (!h1.toLowerCase().includes(cityLower)) { issues.push({ issue: `H1 does not contain city name "${cityTitle}"`, impact: 'Medium', category: 'Headings' }); }

  // Word count
  if (Number(wordCount) < 300) {
    issues.push({ issue: `Thin homepage content (${wordCount} words) — Google prefers 400–700 words for local pages`, impact: 'Medium', category: 'Content' });
  }

  // Page speed
  const speedNum = parseFloat(pageSpeed);
  if (!isNaN(speedNum) && speedNum > 3) {
    issues.push({ issue: `Slow page load (${pageSpeed}s) — directly hurts mobile Google rankings`, impact: 'High', category: 'Performance' });
  }

  // Rating signals
  if (!googleRating) {
    issues.push({ issue: 'Google rating not verified — ensure Google Business Profile is claimed and complete', impact: 'High', category: 'Google Business Profile' });
  } else if (Number(googleRating) < 4.0) {
    issues.push({ issue: `Low Google rating (${googleRating}/5) — impacts click-through in Maps results`, impact: 'High', category: 'Google Business Profile' });
  }
  if (!reviewCount || Number(reviewCount) < 20) {
    issues.push({ issue: `Low review count (${reviewCount || 0}) — restaurants with 50+ reviews rank significantly higher`, impact: 'High', category: 'Google Business Profile' });
  }

  // Local keyword suggestions
  const intentKeywords = HIGH_VALUE_INTENTS.map(intent => `${cuisine !== 'generic' ? cuisine + ' restaurant' : 'restaurant'} ${intent} ${cityTitle}`);
  const cuisineKeywords = (CUISINE_KEYWORDS[cuisine] || CUISINE_KEYWORDS.generic).map(k => `${k} in ${cityTitle}`);
  const hyperLocal = [
    `best restaurant in ${cityTitle}`,
    `${cuisine !== 'generic' ? cuisine + ' food' : 'food'} delivery ${cityTitle}`,
    `${cityTitle} ${cuisine !== 'generic' ? cuisine : ''} restaurant open now`.trim(),
    `family restaurant ${cityTitle}`,
    `romantic dinner ${cityTitle}`,
    `lunch near ${cityTitle} centre`,
    `${cityTitle} weekend brunch`,
    `takeaway ${cityTitle}`
  ];

  missingKeywords.push(...hyperLocal.slice(0, 5), ...cuisineKeywords.slice(0, 3), ...intentKeywords.slice(0, 5));

  // Optimised title & description
  const cuisineLabel = cuisine !== 'generic' ? titleCase(cuisine) + ' ' : '';
  const optimisedTitle = `${data.restaurantName ? titleCase(data.restaurantName) + ' | ' : ''}Best ${cuisineLabel}Restaurant in ${cityTitle} | Book a Table`;
  const optimisedDescription = `Looking for the best ${cuisineLabel.toLowerCase()}restaurant in ${cityTitle}? ${data.restaurantName ? titleCase(data.restaurantName) + ' serves' : 'We serve'} fresh, delicious food in a warm atmosphere. ${googleRating ? '⭐ ' + googleRating + '/5 on Google.' : ''} Dine in, takeaway & delivery available. Book your table today!`;

  // Improvements
  improvements.push(
    { improvement: 'Claim & fully complete your Google Business Profile', detail: 'Add opening hours, photos (min 10), menu link, Q&A responses, and post weekly updates. This is the #1 local ranking factor.', impact: 'High' },
    { improvement: `Add "${cityTitle}" and your cuisine type to your homepage title, H1, and meta description`, detail: `This tells Google exactly what you serve and where. It directly increases your chances of appearing when someone searches "${cuisine} restaurant ${cityTitle}".`, impact: 'High' },
    { improvement: 'Launch a review generation campaign', detail: 'After every positive interaction, ask customers to leave a Google review. Add a QR code to receipts, table cards, and the takeaway packaging. Target 50+ reviews within 60 days.', impact: 'High' }
  );

  // Visibility estimate
  const issueCount = issues.filter(i => i.impact === 'High').length;
  const visibilityEstimate = issueCount >= 4 ? 'High' : issueCount >= 2 ? 'Medium' : 'Low';
  const visibilityExplain = issueCount >= 4
    ? 'Multiple critical issues detected. Fixing them could significantly improve your Google Maps and local search position within 4–8 weeks.'
    : issueCount >= 2
    ? 'Key issues identified. Targeted fixes should yield noticeable improvement in 3–6 weeks.'
    : 'Site is reasonably optimised locally. Incremental improvements will yield moderate gains.';

  return {
    url,
    city: cityTitle,
    cuisine,
    issuesFound: issues,
    missingLocalKeywords: [...new Set(missingKeywords)].slice(0, 15),
    optimisedTitle,
    optimisedMetaDescription: optimisedDescription.substring(0, 158),
    highImpactImprovements: improvements,
    estimatedVisibilityImprovement: { level: visibilityEstimate, explanation: visibilityExplain },
    titleAnalysis: { current: title || '(none)', length: titleLength, hasCityName: hasCityInTitle, score: Math.max(0, titleScore) },
    googlePresence: { rating: googleRating || 'unknown', reviewCount: reviewCount || 0 }
  };
}

// ── PART 2 – Competitor Gap Analysis ─────────────────────────────────────────

function analyseCompetitorGap(restaurantData, competitorData) {
  const myName = titleCase(restaurantData.restaurantName || 'Your Restaurant');
  const compName = titleCase(competitorData.name || 'Competitor');
  const myRating = Number(restaurantData.googleRating) || 0;
  const compRating = Number(competitorData.rating) || 0;
  const myReviews = Number(restaurantData.reviewCount) || 0;
  const compReviews = Number(competitorData.reviewCount) || 0;
  const mySpeed = parseFloat(restaurantData.pageSpeed) || 0;
  const compSpeed = parseFloat(competitorData.pageSpeed) || 0;

  const strengths = [];
  const gaps = [];

  // Rating comparison
  if (compRating > myRating) {
    gaps.push({ area: 'Google Rating', yourValue: myRating || 'unknown', competitorValue: compRating, impact: 'High', insight: `${compName} has a ${(compRating - myRating).toFixed(1)}-point higher rating. In local search, restaurants above 4.3 get significantly more clicks.` });
  } else if (myRating >= compRating && myRating > 0) {
    strengths.push({ area: 'Google Rating', note: `You outperform ${compName} on rating (${myRating} vs ${compRating}).` });
  }

  // Review count
  if (compReviews > myReviews) {
    gaps.push({ area: 'Review Volume', yourValue: myReviews, competitorValue: compReviews, impact: 'High', insight: `${compName} has ${compReviews - myReviews} more reviews. Higher volume signals popularity to Google's algorithm — it is a direct ranking factor in Google Maps.` });
  } else if (myReviews >= compReviews && myReviews > 0) {
    strengths.push({ area: 'Review Volume', note: `You have more reviews than ${compName} (${myReviews} vs ${compReviews}).` });
  }

  // SEO / website
  const compHasCity = (competitorData.metaTags?.title || '').toLowerCase().includes((restaurantData.city || '').toLowerCase());
  const myHasCity = (restaurantData.metaTags?.title || '').toLowerCase().includes((restaurantData.city || '').toLowerCase());
  if (compHasCity && !myHasCity) {
    gaps.push({ area: 'Local Keyword in Title', yourValue: 'Missing city in title', competitorValue: 'City name present', impact: 'High', insight: `${compName}'s title tag includes the city name, making it more relevant to local searches. Your title does not.` });
  }

  // Page speed
  if (compSpeed > 0 && mySpeed > 0) {
    if (mySpeed > compSpeed + 1) {
      gaps.push({ area: 'Page Speed', yourValue: mySpeed + 's', competitorValue: compSpeed + 's', impact: 'Medium', insight: `${compName} loads ${(mySpeed - compSpeed).toFixed(1)}s faster. Faster sites rank higher on mobile search and reduce bounce rate.` });
    } else if (compSpeed > mySpeed + 1) {
      strengths.push({ area: 'Page Speed', note: `Your site loads faster than ${compName}.` });
    }
  }

  // Content
  const myWords = Number(restaurantData.wordCount) || 0;
  const compWords = Number(competitorData.wordCount) || 0;
  if (compWords > myWords + 100) {
    gaps.push({ area: 'Homepage Content Depth', yourValue: myWords + ' words', competitorValue: compWords + ' words', impact: 'Medium', insight: `${compName} has more content on their homepage, giving Google more text to understand relevance. Richer content correlates with better local rankings.` });
  }

  // Schema markup
  if (competitorData.hasSchema && !restaurantData.hasSchema) {
    gaps.push({ area: 'Schema Markup (Structured Data)', yourValue: 'Not detected', competitorValue: 'Present', impact: 'Medium', insight: `${compName} uses Restaurant schema markup, enabling rich results in Google (menu links, star ratings, opening hours). This is a clear ranking and click-through advantage.` });
  }

  // Why competitor attracts more customers
  const reasons = gaps.map(g => `${g.area}: ${g.insight}`);
  if (reasons.length === 0) reasons.push(`${compName} may benefit from longer market presence, stronger word-of-mouth, or higher foot traffic location.`);

  // 5 actions to outperform
  const actions = [
    { action: 'Run a 30-day "Leave Us a Google Review" campaign', detail: 'Print QR code cards, train staff to request reviews after positive interactions, add review link to WhatsApp/email follow-ups. Reviews are the fastest legal way to outrank competitors in Maps.', priority: 1 },
    { action: 'Rewrite your homepage title and meta description with city + cuisine keywords', detail: `Example: "Best ${detectCuisine([restaurantData.metaTags?.title, restaurantData.menuItems].join(' '))} Restaurant in ${titleCase(restaurantData.city || 'Your City')} | [Restaurant Name]". This single change can move you up in local search within weeks.`, priority: 2 },
    { action: 'Add Restaurant Schema markup to your website', detail: 'Add JSON-LD structured data with your name, address, phone, opening hours, cuisine type, and price range. Gives you an immediate technical advantage over competitors missing this.', priority: 3 },
    { action: 'Post weekly on your Google Business Profile', detail: 'Share photos of dishes, daily specials, events, and behind-the-scenes content. Google rewards active profiles with higher map rankings. This is free and takes 5 minutes per week.', priority: 4 },
    { action: `Respond to every ${compName} review left and launch comparison-style social content`, detail: `Create posts like "What makes us different from the rest in ${titleCase(restaurantData.city || 'the city')}?" showcasing your unique strengths (fresher ingredients, family owners, etc.). Authenticity builds preference.`, priority: 5 }
  ];

  return {
    restaurantName: myName,
    competitorName: compName,
    areasWhereCompetitorIsStronger: gaps,
    areasWhereYouAreStronger: strengths,
    whyCompetitorAttractsMoreCustomers: reasons,
    fiveActionsToOutperform: actions
  };
}

// ── PART 3 – Product & Menu Suggestions ──────────────────────────────────────

function suggestMenuItems(data) {
  const existingMenu = (data.menuItems || '').toLowerCase();
  const cuisine = detectCuisine([existingMenu, data.metaTags?.title, data.restaurantName].join(' '));

  // Filter out items already on menu
  const filterNew = items => items.filter(item => !existingMenu.includes(item.name.toLowerCase().split(' ')[0]));

  const newItems = filterNew([
    ...TREND_ITEMS.trendy,
    ...(CUISINE_KEYWORDS[cuisine] ? [
      { name: `Signature ${titleCase(cuisine)} Tasting Menu`, description: `A curated 4-course tasting menu showcasing the best of ${titleCase(cuisine)} cuisine — ideal for special occasions and high-value covers.`, trend: 'Tasting menus driving high spend per head' }
    ] : [])
  ]).slice(0, 5);

  const highMarginItems = filterNew(TREND_ITEMS.highMargin).slice(0, 3);
  const instagramItems = filterNew(TREND_ITEMS.instagrammable).slice(0, 3);

  // Marketing descriptions for top 3 new items
  const marketingDescriptions = newItems.slice(0, 3).map(item => ({
    itemName: item.name,
    menuDescription: item.description,
    socialMediaCaption: `✨ Introducing: ${item.name} — ${item.description.split('.')[0]}. Available now. Book your table or order online today! 🍽️ #${(item.name || '').replace(/\s+/g, '')} #${titleCase(cuisine)}Food #FoodLovers`,
    googleBusinessPostText: `🆕 New on the menu: ${item.name}. ${item.description.split('.')[0]}. Come in and try it this week — we'd love to hear what you think!`
  }));

  return {
    fiveNewMenuItems: newItems,
    threeHighMarginItems: highMarginItems,
    threeInstagramItems: instagramItems,
    marketingDescriptions
  };
}

// ── PART 4 – Review Intelligence ─────────────────────────────────────────────

function analyseReviews(data) {
  const sentiment = analyseReviewSentiment(data.sampleReviews || '');
  if (!sentiment) {
    return {
      note: 'No sample reviews provided. Add customer reviews to get detailed review intelligence.',
      reviewCount: 0,
      mostPraisedAspects: [],
      mostCommonComplaints: [],
      operationalImprovements: [],
      negativeReviewResponses: generateNegativeResponse('service'),
      positiveReviewResponses: generatePositiveResponse('food and atmosphere')
    };
  }

  const { reviews, topPraised, topComplaints } = sentiment;
  const operationalImprovements = buildOperationalImprovements(topComplaints);

  const negativeReviewResponses = generateNegativeResponse(topComplaints[0] || 'service');
  const positiveReviewResponses = generatePositiveResponse(topPraised[0] || 'experience');

  return {
    reviewCount: reviews.length,
    mostPraisedAspects: topPraised.length > 0 ? topPraised : ['food quality', 'atmosphere', 'service'],
    mostCommonComplaints: topComplaints.length > 0 ? topComplaints : ['No major complaints detected'],
    operationalImprovements: operationalImprovements.length > 0 ? operationalImprovements : ['Continue maintaining current service standards. Focus on consistency.'],
    negativeReviewResponses,
    positiveReviewResponses
  };
}

// ── PART 5 – Simple Business Summary ─────────────────────────────────────────

function simpleSummary(seoResult, competitorResult, reviewResult) {
  const city = seoResult.city || 'your city';
  const myName = competitorResult.restaurantName || 'Your restaurant';
  const compName = competitorResult.competitorName || 'your competitor';
  const highIssues = seoResult.issuesFound.filter(i => i.impact === 'High').length;
  const visLevel = seoResult.estimatedVisibilityImprovement.level;

  return `Hey! Here's a simple summary of what we found and what you should do to get more customers.

RIGHT NOW — WHY YOU MIGHT NOT BE GETTING ENOUGH CUSTOMERS FROM GOOGLE:
When someone in ${city} searches for food online, Google shows restaurants it trusts most. Right now, ${myName} has ${highIssues > 0 ? highIssues + ' important thing' + (highIssues > 1 ? 's' : '') + ' missing that are making Google less likely to show your restaurant.' : 'good basic visibility — but there are still changes that can bring more customers.'} The most important ones are: your website doesn't clearly tell Google what city you're in, and you ${Number(seoResult.googlePresence.reviewCount) < 30 ? 'don\'t have enough Google reviews yet' : 'could get even more Google reviews'}.

HOW TO GET MORE CUSTOMERS:
The number one free thing you can do is ask every happy customer to leave you a Google review. It's completely free and it's the fastest way to rank higher than ${compName} on Google Maps. Just print out a small card with a QR code linking to your Google review page and put it on every table and in every takeaway bag.

HOW TO IMPROVE YOUR GOOGLE PRESENCE:
1. Make sure the title of your website says "${city}" and mentions what food you serve (e.g., "Best Italian Restaurant in ${city}").
2. Log in to Google Business Profile (it's free) and add your opening hours, 10+ food photos, and your menu. Update it every week with a post about your specials.
3. Your Google Maps ranking will improve within 4–8 weeks of doing these things.

HOW TO COMPETE BETTER AGAINST ${compName.toUpperCase()}:
${competitorResult.areasWhereCompetitorIsStronger.length > 0
  ? `${compName} currently has more Google reviews and a higher rating — this is the main reason they may appear above you in search results. You can close this gap within 2 months by actively collecting reviews.`
  : `You are already competitive. Focus on consistency, a stronger social media presence, and new items to attract younger customers.`
}

BOTTOM LINE:
If you follow the 30-day plan below, you can realistically expect ${visLevel === 'High' ? 'a significant increase in Google visibility and new foot traffic' : visLevel === 'Medium' ? 'a noticeable improvement in your Google Maps position and online enquiries' : 'steady, incremental growth in online visibility'}. None of the actions require technical skills — just consistency.`;
}

// ── PART 6 – 30-Day Action Plan ───────────────────────────────────────────────

function buildActionPlan(seoResult, competitorResult, menuResult) {
  const city = seoResult.city;
  const cuisine = seoResult.cuisine;

  return {
    week1_days1to7: {
      focus: 'Google Business Profile & Quick SEO Wins',
      tasks: [
        { task: 'Claim and fully complete Google Business Profile (name, address, phone, hours, category)', timeRequired: '30 min', impact: 'High', cost: 'Free' },
        { task: 'Upload minimum 10 high-quality food and interior photos to Google Business Profile', timeRequired: '20 min', impact: 'High', cost: 'Free' },
        { task: `Rewrite homepage <title> tag to include city and cuisine: "${seoResult.optimisedTitle}"`, timeRequired: '10 min', impact: 'High', cost: 'Free' },
        { task: `Rewrite homepage meta description (120–155 chars): "${seoResult.optimisedMetaDescription.substring(0, 80)}..."`, timeRequired: '10 min', impact: 'High', cost: 'Free' },
        { task: 'Create Google review QR code (use qr-code-generator.com) and print for tables + takeaway bags', timeRequired: '15 min', impact: 'High', cost: 'Free' }
      ]
    },
    week2_days8to14: {
      focus: 'Review Generation & Content Improvements',
      tasks: [
        { task: 'Train all front-of-house staff to verbally request a Google review from every happy customer', timeRequired: '30 min once', impact: 'High', cost: 'Free' },
        { task: 'Add city name and primary keyword to homepage H1 heading', timeRequired: '5 min', impact: 'High', cost: 'Free' },
        { task: 'Expand homepage content to 400–600 words mentioning your cuisine, city, story, and USPs', timeRequired: '60 min', impact: 'Medium', cost: 'Free' },
        { task: `Add Restaurant JSON-LD schema markup to website <head> (copy template from schema.org/Restaurant)`, timeRequired: '30 min', impact: 'Medium', cost: 'Free' },
        { task: 'Respond professionally to all existing Google reviews (positive and negative)', timeRequired: '45 min', impact: 'Medium', cost: 'Free' }
      ]
    },
    week3_days15to21: {
      focus: 'Menu Innovation & Social Media Presence',
      tasks: [
        { task: `Introduce 1 new Instagram-worthy menu item: "${menuResult.threeInstagramItems[0]?.name || 'signature visual dish'}"`, timeRequired: '1 day prep', impact: 'Medium', cost: 'Low' },
        { task: 'Set up / refresh Instagram and Facebook with consistent branding and 3 dish photos per week', timeRequired: '2 hrs setup', impact: 'Medium', cost: 'Free' },
        { task: 'Post first Google Business Profile update (new dish, special offer, or behind-the-scenes story)', timeRequired: '10 min', impact: 'Medium', cost: 'Free' },
        { task: `Create a lunch deal or "date night for 2" set menu to attract midweek covers`, timeRequired: '1 hr', impact: 'Medium', cost: 'Low' },
        { task: 'Add your menu to Google Business Profile and ensure it is up to date on your website', timeRequired: '20 min', impact: 'Medium', cost: 'Free' }
      ]
    },
    week4_days22to30: {
      focus: 'Tracking, Visibility & Ongoing Growth',
      tasks: [
        { task: 'Check Google Search Console for local search queries driving traffic — identify new keyword opportunities', timeRequired: '20 min', impact: 'Medium', cost: 'Free' },
        { task: 'Run a 48-hour "Share this post and win a free starter" social media giveaway', timeRequired: '1 hr', impact: 'Medium', cost: 'Low' },
        { task: `Build 2 local citations: list on TripAdvisor, Yelp, Zomato, and local city food guides`, timeRequired: '1 hr', impact: 'Medium', cost: 'Free' },
        { task: 'Review previous 4 weeks: count new Google reviews, track Maps ranking, assess new foot traffic', timeRequired: '30 min', impact: 'Low', cost: 'Free' },
        { task: 'Plan next month — identify 2 more menu additions based on social engagement and sales data', timeRequired: '1 hr', impact: 'Low', cost: 'Free' }
      ]
    }
  };
}

// ── Main Entry Point ──────────────────────────────────────────────────────────

function runLocalBusinessAudit(input) {
  const {
    restaurantName = '',
    url = '',
    city = '',
    metaTags = {},
    headings = {},
    wordCount = 0,
    pageSpeed = '',
    googleRating = null,
    reviewCount = 0,
    hasSchema = false,
    competitor = {},
    sampleReviews = '',
    menuItems = ''
  } = input;

  const restaurantData = { restaurantName, url, city, metaTags, headings, wordCount, pageSpeed, googleRating, reviewCount, hasSchema, menuItems, sampleReviews };
  const competitorData = { name: competitor.name || '', rating: competitor.rating || 0, reviewCount: competitor.reviewCount || 0, pageSpeed: competitor.pageSpeed || 0, wordCount: competitor.wordCount || 0, metaTags: competitor.metaTags || {}, hasSchema: competitor.hasSchema || false };

  const seoResult        = analyseLocalSEO(restaurantData);
  const competitorResult = analyseCompetitorGap(restaurantData, competitorData);
  const menuResult       = suggestMenuItems(restaurantData);
  const reviewResult     = analyseReviews(restaurantData);
  const summary          = simpleSummary(seoResult, competitorResult, reviewResult);
  const actionPlan       = buildActionPlan(seoResult, competitorResult, menuResult);

  return {
    auditType: 'local_business',
    auditDate: new Date().toISOString().split('T')[0],
    restaurantName: titleCase(restaurantName) || 'Restaurant',
    city,
    local_seo_analysis: seoResult,
    competitor_gap: competitorResult,
    product_suggestions: menuResult,
    review_insights: reviewResult,
    simple_summary: summary,
    action_plan: actionPlan
  };
}

module.exports = { runLocalBusinessAudit };
