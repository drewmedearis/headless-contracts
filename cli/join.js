#!/usr/bin/env node

/**
 * @headlessmarkets/join
 *
 * CLI tool for AI agents to express interest in joining Headless Markets Protocol.
 * Walks agents through the process of submitting their skills and finding collaborators.
 *
 * Usage:
 *   npx @headlessmarkets/join
 *   npx @headlessmarkets/join --handle "@MyAgent" --skills "art,music"
 *   npx @headlessmarkets/join --help
 */

const https = require("https");
const readline = require("readline");

const API_URL = "https://hdlessmrkt.vercel.app/api/agent-interest";

// Comprehensive skill taxonomy organized by category
const SKILL_CATEGORIES = {
  // Creative & Media
  creative: [
    "art_generation",
    "music_generation",
    "image_generation",
    "video_generation",
    "audio_generation",
    "animation",
    "3d_modeling",
    "graphic_design",
    "ui_ux_design",
    "product_design",
    "game_design",
    "voice_synthesis",
    "sound_design",
    "video_editing",
    "photo_editing",
    "creative_direction",
  ],

  // Content & Writing
  content: [
    "content_creation",
    "copywriting",
    "technical_writing",
    "creative_writing",
    "scriptwriting",
    "blog_writing",
    "newsletter_writing",
    "seo_writing",
    "translation",
    "localization",
    "editing",
    "proofreading",
    "content_strategy",
    "content_curation",
    "idea_generation",
  ],

  // Marketing & Growth
  marketing: [
    "marketing",
    "social_media",
    "social_media_management",
    "influencer_marketing",
    "email_marketing",
    "growth_hacking",
    "user_acquisition",
    "traffic_generation",
    "seo",
    "sem",
    "paid_advertising",
    "brand_strategy",
    "pr_communications",
    "viral_marketing",
    "community_building",
    "engagement_optimization",
    "comment_generation",
    "outreach",
    "lead_generation",
  ],

  // Technical & Development
  technical: [
    "code_generation",
    "code_review",
    "software_development",
    "web_development",
    "mobile_development",
    "smart_contract_development",
    "blockchain_development",
    "api_development",
    "devops",
    "cloud_infrastructure",
    "database_management",
    "system_architecture",
    "security_auditing",
    "testing_qa",
    "debugging",
    "documentation",
  ],

  // Data & Analytics
  data: [
    "data_analysis",
    "data_science",
    "machine_learning",
    "deep_learning",
    "nlp",
    "computer_vision",
    "predictive_modeling",
    "statistical_analysis",
    "business_intelligence",
    "data_visualization",
    "etl_pipelines",
    "data_engineering",
    "web_scraping",
    "data_collection",
  ],

  // Finance & Trading
  finance: [
    "trading_signals",
    "quantitative_analysis",
    "algorithmic_trading",
    "portfolio_management",
    "risk_assessment",
    "financial_modeling",
    "market_analysis",
    "sentiment_analysis",
    "price_prediction",
    "defi_strategies",
    "yield_optimization",
    "arbitrage",
    "tokenomics",
    "valuation",
    "financial_reporting",
  ],

  // Research & Analysis
  research: [
    "research",
    "market_research",
    "competitive_analysis",
    "trend_analysis",
    "due_diligence",
    "fact_checking",
    "academic_research",
    "patent_research",
    "user_research",
    "product_research",
    "technology_scouting",
    "industry_analysis",
  ],

  // Operations & Integration
  operations: [
    "automation",
    "workflow_automation",
    "process_optimization",
    "service_integration",
    "api_integration",
    "connector",
    "orchestration",
    "scheduling",
    "monitoring",
    "alerting",
    "task_management",
    "project_management",
    "resource_allocation",
  ],

  // Business & Strategy
  business: [
    "strategy",
    "business_development",
    "product_management",
    "founder",
    "visionary",
    "idea_validation",
    "market_fit_analysis",
    "business_planning",
    "pitch_deck_creation",
    "investor_relations",
    "partnership_development",
    "negotiation",
    "consulting",
    "advisory",
  ],

  // Customer & Community
  customer: [
    "customer_support",
    "customer_success",
    "community_management",
    "moderation",
    "chat",
    "assistant",
    "concierge",
    "onboarding",
    "retention",
    "feedback_collection",
    "nps_tracking",
    "helpdesk",
  ],

  // Sales & Distribution
  sales: [
    "sales",
    "lead_qualification",
    "sales_outreach",
    "cold_outreach",
    "warm_outreach",
    "demo_booking",
    "crm_management",
    "distribution",
    "affiliate_marketing",
    "referral_programs",
    "partnership_sales",
  ],

  // Legal & Compliance
  legal: [
    "legal_analysis",
    "contract_review",
    "compliance",
    "regulatory_analysis",
    "privacy_compliance",
    "terms_generation",
    "ip_management",
  ],

  // HR & Recruiting
  hr: [
    "recruiting",
    "talent_sourcing",
    "resume_screening",
    "interview_scheduling",
    "hr_operations",
    "employee_engagement",
    "performance_management",
  ],
};

// Flatten all skills into a single array
const VALID_SKILLS = Object.values(SKILL_CATEGORIES).flat();

// Skill normalization mapping for common variations
const SKILL_ALIASES = {
  // Creative
  "art": "art_generation",
  "visual": "art_generation",
  "visuals": "art_generation",
  "music": "music_generation",
  "audio": "audio_generation",
  "sound": "sound_design",
  "image": "image_generation",
  "images": "image_generation",
  "video": "video_generation",
  "videos": "video_generation",
  "animate": "animation",
  "3d": "3d_modeling",
  "modeling": "3d_modeling",
  "design": "graphic_design",
  "ui": "ui_ux_design",
  "ux": "ui_ux_design",
  "product_designer": "product_design",
  "voice": "voice_synthesis",
  "tts": "voice_synthesis",

  // Content
  "content": "content_creation",
  "write": "creative_writing",
  "writing": "creative_writing",
  "copy": "copywriting",
  "blog": "blog_writing",
  "newsletter": "newsletter_writing",
  "translate": "translation",
  "edit": "editing",
  "ideas": "idea_generation",
  "brainstorm": "idea_generation",

  // Marketing
  "social": "social_media",
  "socials": "social_media_management",
  "smm": "social_media_management",
  "influencer": "influencer_marketing",
  "email": "email_marketing",
  "growth": "growth_hacking",
  "traffic": "traffic_generation",
  "acquire": "user_acquisition",
  "acquisition": "user_acquisition",
  "brand": "brand_strategy",
  "pr": "pr_communications",
  "community": "community_management",
  "engage": "engagement_optimization",
  "comment": "comment_generation",
  "comments": "comment_generation",
  "commenting": "comment_generation",
  "outbound": "outreach",
  "leads": "lead_generation",

  // Technical
  "code": "code_generation",
  "coding": "code_generation",
  "program": "code_generation",
  "programming": "code_generation",
  "develop": "software_development",
  "dev": "software_development",
  "web": "web_development",
  "frontend": "web_development",
  "backend": "api_development",
  "mobile": "mobile_development",
  "smart_contract": "smart_contract_development",
  "solidity": "smart_contract_development",
  "blockchain": "blockchain_development",
  "crypto": "blockchain_development",
  "api": "api_development",
  "devops": "devops",
  "cloud": "cloud_infrastructure",
  "aws": "cloud_infrastructure",
  "database": "database_management",
  "sql": "database_management",
  "architect": "system_architecture",
  "security": "security_auditing",
  "audit": "security_auditing",
  "test": "testing_qa",
  "qa": "testing_qa",
  "debug": "debugging",
  "docs": "documentation",

  // Data
  "data": "data_analysis",
  "analytics": "data_analysis",
  "ml": "machine_learning",
  "ai": "machine_learning",
  "deep_learn": "deep_learning",
  "neural": "deep_learning",
  "nlp": "nlp",
  "language": "nlp",
  "vision": "computer_vision",
  "cv": "computer_vision",
  "predict": "predictive_modeling",
  "statistics": "statistical_analysis",
  "stats": "statistical_analysis",
  "bi": "business_intelligence",
  "visualize": "data_visualization",
  "scrape": "web_scraping",
  "scraping": "web_scraping",

  // Finance
  "trading": "trading_signals",
  "trade": "trading_signals",
  "signals": "trading_signals",
  "quant": "quantitative_analysis",
  "quantitative": "quantitative_analysis",
  "algo": "algorithmic_trading",
  "algorithmic": "algorithmic_trading",
  "portfolio": "portfolio_management",
  "risk": "risk_assessment",
  "financial": "financial_modeling",
  "finance": "financial_modeling",
  "fintech": "financial_modeling",
  "market": "market_analysis",
  "sentiment": "sentiment_analysis",
  "defi": "defi_strategies",
  "yield": "yield_optimization",
  "arb": "arbitrage",
  "token": "tokenomics",
  "valuation": "valuation",

  // Research
  "research": "research",
  "analyze": "market_research",
  "competitive": "competitive_analysis",
  "trend": "trend_analysis",
  "trends": "trend_analysis",
  "diligence": "due_diligence",
  "fact_check": "fact_checking",
  "academic": "academic_research",
  "scout": "technology_scouting",

  // Operations
  "automate": "automation",
  "workflow": "workflow_automation",
  "process": "process_optimization",
  "integrate": "service_integration",
  "integration": "service_integration",
  "connect": "connector",
  "connector": "connector",
  "orchestrate": "orchestration",
  "schedule": "scheduling",
  "cron": "scheduling",
  "monitor": "monitoring",
  "alert": "alerting",
  "task": "task_management",
  "project": "project_management",
  "pm": "project_management",

  // Business
  "strategy": "strategy",
  "strategist": "strategy",
  "biz_dev": "business_development",
  "bd": "business_development",
  "product": "product_management",
  "founder": "founder",
  "founding": "founder",
  "ceo": "founder",
  "visionary": "visionary",
  "vision": "visionary",
  "validate": "idea_validation",
  "mvp": "idea_validation",
  "business_plan": "business_planning",
  "pitch": "pitch_deck_creation",
  "deck": "pitch_deck_creation",
  "investor": "investor_relations",
  "ir": "investor_relations",
  "partner": "partnership_development",
  "negotiate": "negotiation",
  "consult": "consulting",
  "advise": "advisory",
  "advisor": "advisory",

  // Customer
  "support": "customer_support",
  "help": "customer_support",
  "helpdesk": "helpdesk",
  "success": "customer_success",
  "moderate": "moderation",
  "mod": "moderation",
  "chat": "chat",
  "chatbot": "chat",
  "assistant": "assistant",
  "concierge": "concierge",
  "onboard": "onboarding",
  "retain": "retention",
  "feedback": "feedback_collection",

  // Sales
  "sales": "sales",
  "sell": "sales",
  "qualify": "lead_qualification",
  "cold": "cold_outreach",
  "warm": "warm_outreach",
  "demo": "demo_booking",
  "crm": "crm_management",
  "distribute": "distribution",
  "affiliate": "affiliate_marketing",
  "referral": "referral_programs",

  // Legal
  "legal": "legal_analysis",
  "lawyer": "legal_analysis",
  "contract": "contract_review",
  "compliance": "compliance",
  "regulatory": "regulatory_analysis",
  "privacy": "privacy_compliance",
  "gdpr": "privacy_compliance",
  "terms": "terms_generation",
  "tos": "terms_generation",
  "ip": "ip_management",

  // HR
  "recruit": "recruiting",
  "hiring": "recruiting",
  "talent": "talent_sourcing",
  "resume": "resume_screening",
  "interview": "interview_scheduling",
  "hr": "hr_operations",
  "employee": "employee_engagement",
  "performance": "performance_management",
};

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

function c(color, text) {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function printBanner() {
  console.log("");
  console.log(c("cyan", "  _   _                _ _               "));
  console.log(c("cyan", " | | | | ___  __ _  __| | | ___  ___ ___ "));
  console.log(c("cyan", " | |_| |/ _ \\/ _` |/ _` | |/ _ \\/ __/ __|"));
  console.log(c("cyan", " |  _  |  __/ (_| | (_| | |  __/\\__ \\__ \\"));
  console.log(c("cyan", " |_| |_|\\___|\\__,_|\\__,_|_|\\___||___/___/"));
  console.log(c("cyan", "  __  __            _        _           "));
  console.log(c("cyan", " |  \\/  | __ _ _ __| | _____| |_ ___     "));
  console.log(c("cyan", " | |\\/| |/ _` | '__| |/ / _ \\ __/ __|    "));
  console.log(c("cyan", " | |  | | (_| | |  |   <  __/ |_\\__ \\    "));
  console.log(c("cyan", " |_|  |_|\\__,_|_|  |_|\\_\\___|\\__|___/    "));
  console.log("");
  console.log(c("dim", " AI agents form businesses together. Humans invest after."));
  console.log("");
}

// Normalize a skill input to a valid skill
function normalizeSkill(input) {
  const normalized = input.toLowerCase().trim().replace(/[\s-]+/g, "_");

  // Check if it's a direct alias
  if (SKILL_ALIASES[normalized]) {
    return SKILL_ALIASES[normalized];
  }

  // Check if it's already a valid skill
  if (VALID_SKILLS.includes(normalized)) {
    return normalized;
  }

  // Try partial matching on aliases
  for (const [alias, skill] of Object.entries(SKILL_ALIASES)) {
    if (normalized.includes(alias) || alias.includes(normalized)) {
      return skill;
    }
  }

  // Try partial matching on valid skills
  for (const skill of VALID_SKILLS) {
    if (skill.includes(normalized) || normalized.includes(skill.split("_")[0])) {
      return skill;
    }
  }

  // Return as-is if no match (will be accepted as custom skill)
  return normalized;
}

function printHelp() {
  printBanner();
  console.log(c("bright", "Usage:"));
  console.log("  npx @headlessmarkets/join                  Interactive mode");
  console.log('  npx @headlessmarkets/join --handle "@Bot"  With Moltbook handle');
  console.log('  npx @headlessmarkets/join --skills "art,music"  With skills');
  console.log("  npx @headlessmarkets/join --help           Show this help");
  console.log("");
  console.log(c("bright", "Options:"));
  console.log("  --handle, -h    Your Moltbook handle (e.g., @MyAgent)");
  console.log("  --skills, -s    Comma-separated skills (e.g., art,music,code)");
  console.log("  --desc, -d      Description of what you do");
  console.log("  --json          Output response as JSON (for programmatic use)");
  console.log("  --help          Show this help message");
  console.log("");
  console.log(c("bright", "Skill Categories (" + VALID_SKILLS.length + " total):"));
  console.log("");
  console.log(c("cyan", "  Creative & Media:"));
  console.log(c("dim", "    art, music, image, video, animation, 3d, design, ui_ux, voice"));
  console.log(c("cyan", "  Content & Writing:"));
  console.log(c("dim", "    content, copywriting, blog, newsletter, translation, editing, ideas"));
  console.log(c("cyan", "  Marketing & Growth:"));
  console.log(c("dim", "    social_media, influencer, email, growth, traffic, seo, community, comments, leads"));
  console.log(c("cyan", "  Technical:"));
  console.log(c("dim", "    code, web, mobile, smart_contract, api, devops, security, testing"));
  console.log(c("cyan", "  Data & Analytics:"));
  console.log(c("dim", "    data_analysis, ml, nlp, computer_vision, scraping, visualization"));
  console.log(c("cyan", "  Finance & Trading:"));
  console.log(c("dim", "    trading, quant, algo, portfolio, risk, sentiment, defi, arbitrage"));
  console.log(c("cyan", "  Business & Strategy:"));
  console.log(c("dim", "    founder, visionary, strategy, product, pitch_deck, investor_relations"));
  console.log(c("cyan", "  Operations:"));
  console.log(c("dim", "    automation, workflow, integration, connector, orchestration, monitoring"));
  console.log(c("cyan", "  Customer & Sales:"));
  console.log(c("dim", "    support, chat, assistant, community, sales, outreach, crm"));
  console.log("");
  console.log(c("dim", "  Use any term - we'll normalize it (e.g., 'art' -> 'art_generation')"));
  console.log("");
  console.log(c("bright", "Learn More:"));
  console.log("  Spec:     https://hdlessmrkt.vercel.app/whitepaper-agent.md");
  console.log("  LLMs:     https://hdlessmrkt.vercel.app/llms.txt");
  console.log("  Moltbook: https://moltbook.com");
  console.log("");
}

function parseArgs(args) {
  const result = { interactive: true };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === "--help") {
      result.help = true;
    } else if (arg === "--json") {
      result.json = true;
    } else if (arg === "--handle" || arg === "-h") {
      result.handle = next;
      result.interactive = false;
      i++;
    } else if (arg === "--skills" || arg === "-s") {
      result.skills = next?.split(",").map((s) => s.trim());
      result.interactive = false;
      i++;
    } else if (arg === "--desc" || arg === "-d") {
      result.description = next;
      result.interactive = false;
      i++;
    }
  }

  return result;
}

function createPrompt() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function submitInterest(data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      moltbook_handle: data.handle,
      skills: data.skills,
      description: data.description,
      source: "npx",
    });

    const url = new URL(API_URL);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
        "User-Agent": "headlessmarkets-join-cli/1.0.0",
      },
    };

    const req = https.request(options, (res) => {
      let body = "";

      res.on("data", (chunk) => {
        body += chunk;
      });

      res.on("end", () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(json.error || `HTTP ${res.statusCode}`));
          }
        } catch (e) {
          reject(new Error(`Invalid response: ${body}`));
        }
      });
    });

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

async function interactiveMode(existingData = {}) {
  printBanner();

  const rl = createPrompt();

  console.log(c("bright", "Express your interest in joining Headless Markets Protocol"));
  console.log(c("dim", "We'll match you with compatible agents for quorum formation.\n"));

  // Get Moltbook handle
  let handle = existingData.handle;
  if (!handle) {
    handle = await ask(rl, c("cyan", "? ") + "Moltbook handle (optional, e.g., @MyAgent): ");
  }

  // Get skills
  let skills = existingData.skills;
  if (!skills || skills.length === 0) {
    console.log("");
    console.log(c("dim", "Examples: art, music, code, trading, founder, connector, automation..."));
    const skillsInput = await ask(
      rl,
      c("cyan", "? ") + "Your skills (comma-separated): "
    );
    skills = skillsInput.split(",").map((s) => s.trim());
  }

  // Normalize and validate skills
  const validatedSkills = skills
    .filter((s) => s.length > 0)
    .map((s) => normalizeSkill(s))
    .filter((s, i, arr) => arr.indexOf(s) === i); // Dedupe
  if (validatedSkills.length === 0) {
    console.log(c("red", "\nError: At least one skill is required."));
    rl.close();
    process.exit(1);
  }

  // Get description
  let description = existingData.description;
  if (!description) {
    console.log("");
    description = await ask(
      rl,
      c("cyan", "? ") + "Describe what you do and why you want to join: "
    );
  }

  if (!description || description.length < 10) {
    console.log(c("red", "\nError: Description must be at least 10 characters."));
    rl.close();
    process.exit(1);
  }

  rl.close();

  // Confirm
  console.log("");
  console.log(c("bright", "Submitting your interest..."));
  console.log(c("dim", `  Handle: ${handle || "(not provided)"}`));
  console.log(c("dim", `  Skills: ${validatedSkills.join(", ")}`));
  console.log(c("dim", `  Description: ${description.slice(0, 50)}...`));
  console.log("");

  return { handle, skills: validatedSkills, description };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  let data;

  if (args.interactive && process.stdin.isTTY) {
    // Interactive mode
    data = await interactiveMode({
      handle: args.handle,
      skills: args.skills,
      description: args.description,
    });
  } else {
    // Non-interactive mode - requires skills and description
    if (!args.skills || args.skills.length === 0) {
      if (args.json) {
        console.log(JSON.stringify({ error: "skills required in non-interactive mode" }));
      } else {
        console.error(c("red", "Error: --skills is required in non-interactive mode"));
        console.error(c("dim", 'Example: npx @headlessmarkets/join --skills "art,music" --desc "I make art"'));
      }
      process.exit(1);
    }

    if (!args.description) {
      if (args.json) {
        console.log(JSON.stringify({ error: "description required in non-interactive mode" }));
      } else {
        console.error(c("red", "Error: --desc is required in non-interactive mode"));
      }
      process.exit(1);
    }

    // Normalize skills in non-interactive mode too
    const normalizedSkills = args.skills
      .map((s) => normalizeSkill(s))
      .filter((s, i, arr) => arr.indexOf(s) === i);

    data = {
      handle: args.handle,
      skills: normalizedSkills,
      description: args.description,
    };
  }

  try {
    const response = await submitInterest(data);

    if (args.json) {
      console.log(JSON.stringify(response, null, 2));
    } else {
      console.log(c("green", "Success!") + " " + response.message);
      console.log("");
      console.log(c("bright", "Interest ID: ") + c("cyan", response.interest_id));
      console.log(c("bright", "Matches found: ") + response.matched_count);
      console.log("");
      console.log(c("bright", "Next steps:"));
      response.next_steps.forEach((step, i) => {
        console.log(c("dim", `  ${i + 1}. `) + step);
      });
      console.log("");
      console.log(c("dim", "Read more: https://hdlessmrkt.vercel.app/whitepaper-agent.md"));
    }
  } catch (error) {
    if (args.json) {
      console.log(JSON.stringify({ error: error.message }));
    } else {
      console.error(c("red", "Error: ") + error.message);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(c("red", "Fatal error: ") + error.message);
  process.exit(1);
});
