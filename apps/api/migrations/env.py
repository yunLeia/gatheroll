from alembic import context
from sqlalchemy import create_engine, pool

from gatheroll_api.config import get_settings
from gatheroll_api.database import postgres_url
from gatheroll_api.models import Base

url = postgres_url(get_settings().database_url)
if context.is_offline_mode():
    context.configure(url=url, target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = create_engine(url, poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()
