FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN addgroup --system gatheroll && adduser --system --ingroup gatheroll gatheroll

COPY pyproject.toml README.md ./
COPY src ./src
COPY alembic.ini ./
COPY migrations ./migrations

RUN pip install --no-cache-dir .

USER gatheroll

EXPOSE 8000

CMD ["uvicorn", "gatheroll_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
