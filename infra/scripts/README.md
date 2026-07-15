# Formal CI scripts

These dependency-free Node.js scripts enforce PR-00 repository, dependency, scope, and clean-standalone gates. They inspect only formal paths; they do not import, read, or execute legacy spike implementations. Run them with the repository-pinned Node 22 runtime.

The standalone smoke script copies only `.next/standalone`, public files, and Next static assets into a disposable directory, verifies live/ready/root/Admin/static responses, exercises an S3 readiness outage, restarts the process, checks Sharp runtime presence, and rejects tracing warnings. Runtime paths and summaries belong in temporary directories and must not be committed.
