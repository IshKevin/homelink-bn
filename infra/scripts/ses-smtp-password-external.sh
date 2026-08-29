#!/bin/bash
# Terraform `external` data source wrapper around the same SigV4-derived
# conversion algorithm as ses-smtp-password.sh (see that file for the
# algorithm reference) — reads {"secret":"...","region":"..."} JSON on
# stdin, writes {"password":"..."} JSON to stdout, per the external
# provider's contract. Runs at `terraform apply` time on the machine
# running Terraform, not on any EC2 instance, so the raw IAM secret never
# has to be embedded in user_data — only the final derived SMTP password
# does (see compute.tf's aws_instance.jenkins).
set -euo pipefail

INPUT="$(cat)"
SECRET="$(printf '%s' "$INPUT" | python3 -c "import json,sys; print(json.load(sys.stdin)['secret'])")"
REGION="$(printf '%s' "$INPUT" | python3 -c "import json,sys; print(json.load(sys.stdin)['region'])")"

hmac_sha256_hex() {
  printf '%s' "$2" | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$1" | awk '{print $NF}'
}

key0_hex="$(printf 'AWS4%s' "$SECRET" | xxd -p -c 256 | tr -d '\n')"
k_date="$(hmac_sha256_hex "$key0_hex" "11111111")"
k_region="$(hmac_sha256_hex "$k_date" "$REGION")"
k_service="$(hmac_sha256_hex "$k_region" "ses")"
k_signing="$(hmac_sha256_hex "$k_service" "aws4_request")"
signature_hex="$(hmac_sha256_hex "$k_signing" "SendRawEmail")"

PASSWORD="$(printf '04%s' "$signature_hex" | xxd -r -p | base64)"
PASSWORD="$PASSWORD" python3 -c "import json,os; print(json.dumps({'password': os.environ['PASSWORD']}))"
