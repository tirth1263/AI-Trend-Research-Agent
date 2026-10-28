# Runs the full Python ADK pipeline with the ADK web UI.
# docker build -t ai-trend-agent . && docker run -p 8000:8000 --env-file .env ai-trend-agent
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY analyzer_agent ./analyzer_agent
COPY main.py .
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "adk web --host 0.0.0.0 --port ${PORT} ."]
