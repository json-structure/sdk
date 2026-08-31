# Release troubleshooting

## Checksum mismatch

Delete the package and metadata, download both again from the same official release, and retry. Do not install an artifact whose size, SHA-256, or SHA-512 digest differs.

## Signature or notarization failure

Confirm the package came from the official release and that the operating-system trust store is current. CI packages built without signing secrets are intentionally unsigned and are not production packages.

## Artifact scan failure

Remove credentials and absolute build paths at their source. Declare only executables intentionally shipped by the product, using release-root-relative POSIX paths. Never allowlist a file merely to make the scan pass.

## Offline operation

Editing should work after installation without downloading packages. Conversion or registry actions that require unavailable remote resources must report that dependency without sending document content.