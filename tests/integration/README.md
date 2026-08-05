# Integration tests

This directory contains cross-module and generated-project evidence:

- base Supabase modules type-check after installation;
- password auth structure and security helpers execute against generated files;
- pinned upstream, mutated, and golden fixture hashes are verified;
- fresh installations are compared with committed golden projects;
- the committed example is copied to a clean temporary project, installed from
  its frozen lockfile, built normally and in Deno Deploy mode, then exercised
  through its compiled Fresh server entry against a fake Supabase Auth HTTP
  service.

The ordinary test run reads but never regenerates committed fixture or golden
evidence.
