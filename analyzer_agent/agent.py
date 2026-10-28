"""AI Trends Analysis Pipeline — a 5-agent sequential pipeline built with Google ADK.

    ExaAgent ─▶ TavilyAgent ─▶ SummaryAgent ─▶ FirecrawlAgent ─▶ AnalysisAgent

Every agent writes its answer into the shared session state via ``output_key``;
later agents read those values through ``{state_key}`` placeholders in their
instructions. Run it with ``adk run analyzer_agent`` or ``adk web``.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from google.adk.agents import LlmAgent, SequentialAgent
from google.adk.models.lite_llm import LiteLlm

from .tools import exa_search_ai, firecrawl_scrape_nebius, tavily_search_ai_analysis

load_dotenv()

API_BASE = os.getenv("NEBIUS_API_BASE", "https://api.tokenfactory.nebius.com/v1")
API_KEY = os.getenv("NEBIUS_API_KEY")

# Fast, cheap model for the tool-calling / formatting agents.
WORKER_MODEL = os.getenv("NEBIUS_MODEL", "meta-llama/Meta-Llama-3.1-8B-Instruct")
# Large reasoning model for the final analysis.
ANALYSIS_MODEL = os.getenv("NEBIUS_ANALYSIS_MODEL", "nvidia/Llama-3_1-Nemotron-Ultra-253B-v1")


def nebius(model: str) -> LiteLlm:
    """Nebius Token Factory is OpenAI-compatible, so LiteLLM routes it via the ``openai/`` prefix."""
    return LiteLlm(model=f"openai/{model}", api_base=API_BASE, api_key=API_KEY)


# --- Agent 1: Exa — latest AI news from Twitter/X ---
exa_agent = LlmAgent(
    name="ExaAgent",
    model=nebius(WORKER_MODEL),
    description="Fetches latest AI news, LLMs, and advancements using Exa.",
    instruction="""
Use the exa_search_ai tool to fetch the latest information about AI, new LLMs, and
advancements in the field from Twitter and X.
List the most important items with their source URLs. Do not invent items that the tool did not return.
Prefix your response with "**🔥ExaAgent:**" to clearly identify your output.
""",
    tools=[exa_search_ai],
    output_key="exa_results",
)

# --- Agent 2: Tavily — AI benchmarks & analysis ---
tavily_agent = LlmAgent(
    name="TavilyAgent",
    model=nebius(WORKER_MODEL),
    description="Fetches AI benchmarks, statistics, and analysis using Tavily.",
    instruction="""
Use the tavily_search_ai_analysis tool to retrieve benchmarks, statistics, and relevant analysis on AI.
Keep concrete numbers (scores, prices, speeds) and cite source URLs.
Prefix your response with "**🐳TavilyAgent:**" to clearly identify your output.
""",
    tools=[tavily_search_ai_analysis],
    output_key="tavily_results",
)

# --- Agent 3: Summary & formatting ---
summary_agent = LlmAgent(
    name="SummaryAgent",
    model=nebius(WORKER_MODEL),
    description="Summarizes and formats Exa and Tavily results.",
    instruction="""
You are a summarizer and formatter.

Latest AI updates (from ExaAgent):
{exa_results?}

AI benchmarks and analysis (from TavilyAgent):
{tavily_results?}

- Combine the information above into one structured summary, highlighting key trends, new LLMs, and relevant statistics.
- Use markdown formatting with headings and bullet points.
- Use emojis like 🚀 for new launches, 📊 for statistics, and 📈 for trends.
- Prefix your response with "**🍥SummaryAgent:**" to clearly identify your output.
""",
    output_key="final_summary",
)

# --- Agent 4: Firecrawl — Nebius Token Factory model catalogue ---
firecrawl_agent = LlmAgent(
    name="FirecrawlAgent",
    model=nebius(WORKER_MODEL),
    description="Scrapes Nebius Token Factory homepage using Firecrawl.",
    instruction="""
Use the firecrawl_scrape_nebius tool to fetch markdown content from the Nebius Token Factory website.
Extract the available models with whatever details are present (name, provider, context window,
pricing, specialities) and present them as a clean markdown list or table.
Prefix your response with "**🔥FirecrawlAgent:**"
""",
    tools=[firecrawl_scrape_nebius],
    output_key="firecrawl_content",
)

# --- Agent 5: Deep analysis & Nebius model recommendations ---
analysis_agent = LlmAgent(
    name="AnalysisAgent",
    model=nebius(ANALYSIS_MODEL),
    description="Analyzes the summary and presents insights, statistics and Nebius model recommendations.",
    instruction="""
You are an AI analyst specializing in the latest AI trends and Large Language Models (LLMs).

## Inputs
### final_summary
{final_summary?}

### exa_results
{exa_results?}

### tavily_results
{tavily_results?}

### firecrawl_content (Nebius Token Factory models)
{firecrawl_content?}

## Your task
- Analyze the final_summary, combining it with your knowledge of AI advancements and the details in exa_results and tavily_results.
- Identify key trends, growth areas, and notable statistics related to AI and LLMs.
- Carefully examine firecrawl_content: it describes the models available on Nebius Token Factory (names, pricing, token limits, availability).
- Focus on the functional capabilities and intended use cases of the LLMs in the summary, not just their names.
- Cross-reference those capabilities with the Nebius offerings, prioritising similar context window size, training data or specialised skills.
- If a relevant LLM is available on Nebius, recommend it specifically: features, pricing, token limits and benefits.
- If there is no exact match, suggest the Nebius models with the closest functional alignment, and mention fine-tuning where it would close the gap.
- Be clear and concise, and back claims with quantifiable data.
- Use markdown tables for statistics, for example:

| Metric | Value |
|---|---|
| Growth Rate | 25% |
| Market Size | $100 Billion |

- Always prefix your response with "**🔍AnalysisAgent:**" for clear identification.
""",
    output_key="analysis_results",
)

# --- Orchestrator: run the five agents in order ---
root_agent = SequentialAgent(
    name="AIPipelineAgent",
    description="Five-stage pipeline: news → benchmarks → summary → Nebius catalogue → analysis.",
    sub_agents=[exa_agent, tavily_agent, summary_agent, firecrawl_agent, analysis_agent],
)
