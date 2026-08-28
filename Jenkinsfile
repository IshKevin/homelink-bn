// Backend deploy pipeline: build the Docker image, push to GHCR, redeploy the
// app box via SSM Run Command. Runs on the Jenkins box itself (no agents) —
// it builds directly on the host Docker daemon, no Docker-in-Docker.
//
// Requires (see infra/README.md):
//   - A Jenkins credential, ID "ghcr-token": username = GitHub username,
//     password = a GitHub PAT with write:packages.
//   - /etc/homelink/deploy.env on the box (written by
//     infra/terraform/user-data/jenkins.sh.tpl) — provides AWS_REGION and
//     APP_INSTANCE_ID.
pipeline {
    agent any

    options {
        disableConcurrentBuilds()
        timestamps()
    }

    environment {
        REPOSITORY = "ghcr.io/ishkevin/homelink-bn" // must be lowercase; adjust if the repo owner/name differs
        IMAGE_TAG  = "${env.GIT_COMMIT}"
    }

    stages {
        stage('Build & push') {
            steps {
                withCredentials([usernamePassword(credentialsId: 'ghcr-token', usernameVariable: 'GHCR_USER', passwordVariable: 'GHCR_PASS')]) {
                    sh '''
                        set -euo pipefail
                        echo "$GHCR_PASS" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
                        docker build \
                          --build-arg GIT_COMMIT="$IMAGE_TAG" \
                          --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
                          --build-arg IMAGE_TAG="$IMAGE_TAG" \
                          -t "$REPOSITORY:$IMAGE_TAG" .
                        docker push "$REPOSITORY:$IMAGE_TAG"
                    '''
                }
            }
        }

        stage('Deploy via SSM') {
            steps {
                sh '''
                    set -euo pipefail
                    . /etc/homelink/deploy.env

                    DEPLOY_SCRIPT="set -euo pipefail; cd /opt/homelink; git pull; render-env.sh; export IMAGE_TAG=$IMAGE_TAG; docker compose -f docker-compose.yml -f infra/docker-compose.prod.yml --env-file .env pull migrate seed-admin seed-demo api worker; docker compose -f docker-compose.yml -f infra/docker-compose.prod.yml --env-file .env up -d"

                    COMMAND_ID=$(aws ssm send-command \
                      --instance-ids "$APP_INSTANCE_ID" \
                      --document-name "AWS-RunShellScript" \
                      --comment "Deploy backend $IMAGE_TAG (Jenkins build $BUILD_NUMBER)" \
                      --parameters commands="[\\"sudo -u ec2-user -i bash -c '$DEPLOY_SCRIPT'\\"]" \
                      --region "$AWS_REGION" \
                      --query "Command.CommandId" --output text)

                    aws ssm wait command-executed --command-id "$COMMAND_ID" --instance-id "$APP_INSTANCE_ID" --region "$AWS_REGION" || true

                    STATUS=$(aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$APP_INSTANCE_ID" --region "$AWS_REGION" --query "Status" --output text)
                    aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$APP_INSTANCE_ID" --region "$AWS_REGION" --query "StandardOutputContent" --output text
                    aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$APP_INSTANCE_ID" --region "$AWS_REGION" --query "StandardErrorContent" --output text >&2

                    if [ "$STATUS" != "Success" ]; then
                      echo "Deploy command finished with status: $STATUS"
                      exit 1
                    fi
                '''
            }
        }
    }

    post {
        always {
            sh 'docker logout ghcr.io || true'
        }
    }
}
