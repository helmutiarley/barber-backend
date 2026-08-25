# Creates every database named in POSTGRES_ADDITIONAL_DATABASES (comma-separated)
# beside the primary POSTGRES_DB, so dev and test share one server without
# sharing any data.
#
# Postgres only runs this on first initialisation of the data volume. If you add
# a database here later, `npm run reset:db` is what re-runs it.
set -euo pipefail

databases="${POSTGRES_ADDITIONAL_DATABASES:-}"

if [ -z "$databases" ]; then
  exit 0
fi

for database in ${databases//,/ }; do
  echo "  creating additional database '$database'"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE "$database" OWNER "$POSTGRES_USER";
EOSQL
done
