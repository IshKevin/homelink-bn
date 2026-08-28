#!/bin/bash
# Converts an IAM secret access key into an SES SMTP password, per AWS's
# documented SigV4-derived conversion algorithm:
# https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html
#
# Usage:
#   terraform -chdir=infra/terraform output -raw ses_smtp_secret_access_key \
#     | infra/scripts/ses-smtp-password.sh eu-west-1
#
# Requires: openssl, xxd
set -euo pipefail

REGION="${1:?Usage: ses-smtp-password.sh <region>, secret read from stdin}"
SECRET="$(cat)"

hmac_sha256_hex() {
  # $1 = hex key, $2 = message
  printf '%s' "$2" | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$1" | awk '{print $NF}'
}

key0_hex="$(printf 'AWS4%s' "$SECRET" | xxd -p -c 256 | tr -d '\n')"
k_date="$(hmac_sha256_hex "$key0_hex" "11111111")"
k_region="$(hmac_sha256_hex "$k_date" "$REGION")"
k_service="$(hmac_sha256_hex "$k_region" "ses")"
k_signing="$(hmac_sha256_hex "$k_service" "aws4_request")"
signature_hex="$(hmac_sha256_hex "$k_signing" "SendRawEmail")"

# Version byte 0x04, prepended to the signature, then base64-encoded.
printf '04%s' "$signature_hex" | xxd -r -p | base64
