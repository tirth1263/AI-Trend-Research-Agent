"""Data-gathering tools used by the pipeline's agents.

Each tool returns a plain ``dict`` so ADK can hand it straight back to the LLM
as a function response. Failures never raise: they return an ``error`` field,
which lets the downstream agents keep going with partial data.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any

from exa_py import Exa
from firecrawl import Firecrawl
from tavily import TavilyClient

# Keep tool payloads small enough for an 8B model's context to stay focused.
MAX_TEXT_CHARS = 1_200
MAX_MARKDOWN_CHARS = 25_000

NEBIUS_TOKEN_FACTORY_URL = "https://tokenfactory.nebius.com/"


def _trim(text: str | None, limit: int = MAX_TEXT_CHARS) -> str:
    """Collapse whitespace and cut ``text`` to ``limit`` characters."""
    if not text:
        return ""
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit].rstrip() + " …"


# --- Tool 1: Exa search (latest AI news from Twitter / X) ---
def exa_search_ai(query: str = "") -> dict[str, Any]:
    """Fetch the latest AI news, new LLM launches and agent advancements posted on Twitter/X.

    Args:
        query: Optional extra search terms. Leave empty for the default AI-news query.
    """
    try:
        exa = Exa(api_key=os.getenv("EXA_API_KEY"))
        response = exa.search_and_contents(
            query=query or "Latest AI news OR new LLM models OR AI/Agents advancements",
            include_domains=["twitter.com", "x.com"],
            num_results=10,
            type="auto",
            text=True,
            highlights={"highlights_per_url": 2, "num_sentences": 3},
            start_published_date=(datetime.now(timezone.utc) - timedelta(days=30)).isoformat(),
        )
        return {
            "type": "exa",
            "results": [
                {
                    "title": r.title,
                    "url": r.url,
                    "author": getattr(r, "author", None),
                    "published_date": getattr(r, "published_date", None),
                    "highlights": getattr(r, "highlights", None) or [],
                    "text": _trim(getattr(r, "text", None)),
                }
                for r in response.results
            ],
        }
    except Exception as e:  # noqa: BLE001 - surface any SDK/network error to the LLM
        return {"type": "exa", "error": f"Exa search failed: {e}", "results": []}


# --- Tool 2: Tavily search (AI benchmarks & provider analysis) ---
def tavily_search_ai_analysis(query: str = "") -> dict[str, Any]:
    """Retrieve recent AI benchmarks, LLM statistics and AI-provider analysis.

    Args:
        query: Optional extra search terms. Leave empty for the default benchmarks query.
    """
    try:
        client = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))
        response = client.search(
            query=query or "AI benchmarks OR AI/LLM statistics OR AI providers analysis",
            search_depth="advanced",
            time_range="week",
            include_domains=["artificialanalysis.ai"],
            max_results=8,
        )
        return {
            "type": "tavily",
            "results": [
                {
                    "title": r.get("title"),
                    "url": r.get("url"),
                    "score": r.get("score"),
                    "content": _trim(r.get("content")),
                }
                for r in response.get("results", [])
            ],
        }
    except Exception as e:  # noqa: BLE001
        return {"type": "tavily", "error": f"Tavily search failed: {e}", "results": []}


# --- Tool 3: Firecrawl scraper (Nebius Token Factory model catalogue) ---
def firecrawl_scrape_nebius(url: str = "") -> dict[str, Any]:
    """Scrape the Nebius Token Factory website and return its content as markdown.

    Args:
        url: Optional page to scrape. Defaults to the Nebius Token Factory homepage.
    """
    try:
        firecrawl = Firecrawl(api_key=os.getenv("FIRECRAWL_API_KEY"))
        doc = firecrawl.scrape(
            url or NEBIUS_TOKEN_FACTORY_URL,
            formats=["markdown"],
            only_main_content=True,
        )
        markdown = getattr(doc, "markdown", None)
        if not markdown:
            return {"type": "firecrawl", "error": "Scraping returned no content."}
        return {"type": "firecrawl", "markdown": markdown[:MAX_MARKDOWN_CHARS]}
    except Exception as e:  # noqa: BLE001
        return {"type": "firecrawl", "error": f"Firecrawl scrape failed: {e}"}
