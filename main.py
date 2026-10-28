"""Run the AI Trends Analysis Pipeline once from the command line.

    python main.py            # prints the final AnalysisAgent report
    python main.py --verbose  # also prints every intermediate agent's output
"""

import argparse
import asyncio

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from analyzer_agent.agent import root_agent

APP_NAME = "ai_analysis_pipeline"
USER_ID = "cli_user"
SESSION_ID = "ai_analysis_session"


async def run_ai_analysis(verbose: bool = False) -> str:
    session_service = InMemorySessionService()
    await session_service.create_session(app_name=APP_NAME, user_id=USER_ID, session_id=SESSION_ID)
    runner = Runner(agent=root_agent, app_name=APP_NAME, session_service=session_service)

    message = types.Content(role="user", parts=[types.Part(text="Start the AI analysis")])
    final_text = ""
    async for event in runner.run_async(user_id=USER_ID, session_id=SESSION_ID, new_message=message):
        if not (event.is_final_response() and event.content and event.content.parts):
            continue
        text = "".join(p.text or "" for p in event.content.parts)
        if verbose:
            print(f"\n──────── {event.author} ────────\n{text}")
        final_text = text  # the last final response comes from AnalysisAgent
    return final_text


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AI Trends Analysis Pipeline")
    parser.add_argument("--verbose", "-v", action="store_true", help="print every agent's output")
    args = parser.parse_args()

    report = asyncio.run(run_ai_analysis(verbose=args.verbose))
    if not args.verbose:
        print("📢 AI News Analysis and Insights:\n")
        print(report)
