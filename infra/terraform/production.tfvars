# Production values, matching what's deployed. No secrets in here — every
# secret lives in SSM (set out of band) and its Terraform resource ignores
# value changes. Use it with:
#
#   terraform plan  -var-file=production.tfvars
#   terraform apply -var-file=production.tfvars

domain_name = "homelink.rw"

# homelink.rw's DNS is hosted at aos.rw (ns4/ns5.aos.rw), not Cloudflare —
# records there are managed by hand.
enable_cloudflare_dns = false

s3_bucket_name = "homelink-production-storage-1dc9bda3"

github_frontend_repo = "IshKevin/homelinkRwa"

additional_cors_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]

# Jenkins UI/webhooks are reachable over HTTPS from anywhere (GitHub webhook
# delivery). Narrow this to your own IPs plus GitHub's hook ranges to tighten.
jenkins_admin_cidr_blocks = ["0.0.0.0/0"]

admin_email = "carterk279@gmail.com"
# Placeholder — only gates whether the admin_password SSM parameter exists;
# its real value is set in SSM and Terraform ignores changes to it.
admin_password = "managed-in-ssm"
