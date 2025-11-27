# Maven Central Publishing Setup

This guide covers how to publish the JSON Structure Java SDK to Maven Central.

## Prerequisites

### 1. Register with Sonatype Central Portal

1. Go to [https://central.sonatype.com/](https://central.sonatype.com/)
2. Sign in with your GitHub account (or create an account)
3. You'll need to verify domain ownership for your group ID

### 2. Verify Namespace (Group ID)

The namespace `org.json-structure` has been registered and verified.

1. In the Central Portal, go to **Namespaces**
2. The namespace `org.json-structure` should show as verified

Alternatively, if using a custom domain:
- Add a TXT record to your DNS with the verification code provided

### 3. Generate GPG Keys

All artifacts must be signed with GPG.

```bash
# Generate a new GPG key pair
gpg --gen-key

# List your keys
gpg --list-keys

# Export your public key to a keyserver
gpg --keyserver keyserver.ubuntu.com --send-keys YOUR_KEY_ID
# Also upload to:
gpg --keyserver keys.openpgp.org --send-keys YOUR_KEY_ID

# Export secret key (for CI/CD)
gpg --export-secret-keys YOUR_KEY_ID | base64 > gpg-secret-key.txt
```

### 4. Configure Maven Settings

Create or update `~/.m2/settings.xml`:

```xml
<settings>
    <servers>
        <server>
            <id>central</id>
            <username>YOUR_CENTRAL_PORTAL_TOKEN_USERNAME</username>
            <password>YOUR_CENTRAL_PORTAL_TOKEN_PASSWORD</password>
        </server>
        <server>
            <id>ossrh</id>
            <username>YOUR_SONATYPE_USERNAME</username>
            <password>YOUR_SONATYPE_PASSWORD</password>
        </server>
    </servers>
    <profiles>
        <profile>
            <id>gpg</id>
            <properties>
                <gpg.executable>gpg</gpg.executable>
                <gpg.passphrase>YOUR_GPG_PASSPHRASE</gpg.passphrase>
            </properties>
        </profile>
    </profiles>
    <activeProfiles>
        <activeProfile>gpg</activeProfile>
    </activeProfiles>
</settings>
```

### 5. Generate Central Portal Token

1. Log in to [https://central.sonatype.com/](https://central.sonatype.com/)
2. Click on your username → **View Account**
3. Go to **Generate User Token**
4. Copy the username and password to your `settings.xml`

## Publishing

### Local Release

```bash
# Update version (remove -SNAPSHOT for release)
mvn versions:set -DnewVersion=1.0.0

# Build and deploy
mvn clean deploy -Prelease

# If using central-publishing-maven-plugin, artifacts will be automatically published
# If using nexus-staging-maven-plugin, you may need to manually release from staging
```

### GitHub Actions (CI/CD)

Add these secrets to your repository:

| Secret Name | Description |
|------------|-------------|
| `MAVEN_CENTRAL_USERNAME` | Central Portal token username |
| `MAVEN_CENTRAL_PASSWORD` | Central Portal token password |
| `GPG_PRIVATE_KEY` | Base64-encoded GPG private key |
| `GPG_PASSPHRASE` | GPG key passphrase |

Example workflow (`.github/workflows/publish.yml`):

```yaml
name: Publish to Maven Central

on:
  release:
    types: [created]
  workflow_dispatch:

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
          server-id: central
          server-username: MAVEN_USERNAME
          server-password: MAVEN_PASSWORD
          gpg-private-key: ${{ secrets.GPG_PRIVATE_KEY }}
          gpg-passphrase: GPG_PASSPHRASE
      
      - name: Publish to Maven Central
        working-directory: java
        run: mvn clean deploy -Prelease -DskipTests
        env:
          MAVEN_USERNAME: ${{ secrets.MAVEN_CENTRAL_USERNAME }}
          MAVEN_PASSWORD: ${{ secrets.MAVEN_CENTRAL_PASSWORD }}
          GPG_PASSPHRASE: ${{ secrets.GPG_PASSPHRASE }}
```

## POM Requirements Checklist

Maven Central requires these elements in your POM:

- [x] `groupId`, `artifactId`, `version` - Project coordinates
- [x] `name` - Human-readable project name
- [x] `description` - Project description
- [x] `url` - Project URL
- [x] `licenses` - License information with `distribution` element
- [x] `developers` - Developer information
- [x] `scm` - Source control management URLs
- [x] Sources JAR (`maven-source-plugin`)
- [x] Javadoc JAR (`maven-javadoc-plugin`)
- [x] GPG signatures (`maven-gpg-plugin`)

## Troubleshooting

### "Invalid POM" errors
- Ensure all required elements are present
- Verify the groupId matches your verified namespace

### GPG signing issues
```bash
# Check if GPG agent is running
gpgconf --kill gpg-agent
gpg-agent --daemon

# Test signing
echo "test" | gpg --clearsign
```

### Deployment fails
- Verify your credentials in `settings.xml`
- Check that your namespace is verified
- Ensure version doesn't end in `-SNAPSHOT` for releases

## Useful Links

- [Sonatype Central Portal](https://central.sonatype.com/)
- [Central Publishing Requirements](https://central.sonatype.org/publish/requirements/)
- [GPG Signing Guide](https://central.sonatype.org/publish/requirements/gpg/)
- [Choosing Coordinates](https://central.sonatype.org/publish/requirements/coordinates/)
