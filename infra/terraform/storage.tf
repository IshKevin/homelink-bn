resource "random_id" "bucket_suffix" {
  count       = var.s3_bucket_name == null ? 1 : 0
  byte_length = 4
}

locals {
  s3_bucket_name = coalesce(var.s3_bucket_name, "${local.name_prefix}-storage-${try(random_id.bucket_suffix[0].hex, "")}")
}

# Property photos, generated invoice/lease PDFs, identity documents —
# docs/INFRASTRUCTURE.md §1.
resource "aws_s3_bucket" "app" {
  bucket = local.s3_bucket_name
}

resource "aws_s3_bucket_public_access_block" "app" {
  bucket = aws_s3_bucket.app.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "app" {
  bucket = aws_s3_bucket.app.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "app" {
  bucket = aws_s3_bucket.app.id

  versioning_configuration {
    status = "Disabled"
  }
}
