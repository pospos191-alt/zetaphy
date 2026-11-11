#!/usr/bin/env bash
# Fixture for audit/tools/no-downgrade.test.js: the shape of the real setup-node.sh (pins + an embedded patch).
COSMOS_EVM_TAG="v0.7.3"
COSMOS_EVM_COMMIT="c3ae9067a7eadcdea55a5192226916deb44c71c4"
GO_VERSION="1.26.11"               # comment
WASMVM_VERSION="v3.0.9"

apply_patch() {
  git apply <<'PATCH'
diff --git a/evmd/go.mod b/evmd/go.mod
index e503386..f20f59b 100644
--- a/evmd/go.mod
+++ b/evmd/go.mod
@@ -1,10 +1,12 @@
 module github.com/cosmos/evm/evmd
 
-go 1.25.9
+go 1.26.11
 
 require (
 	cosmossdk.io/api v1.0.0
-	cosmossdk.io/client/v2 v2.0.0-beta.10.0.20260227212600-39d4711b8970
+	cosmossdk.io/client/v2 v2.11.0
+	github.com/CosmWasm/wasmd v0.70.5
 	github.com/cometbft/cometbft v0.39.3
-	golang.org/x/net v0.57.0
+	golang.org/x/net v0.60.0
 )
@@ -25,6 +27,6 @@ require (
 	github.com/spf13/viper v1.21.0
-	golang.org/x/crypto v0.54.0 // indirect
+	golang.org/x/crypto v0.57.0 // indirect
 	golang.org/x/exp v0.0.0-20260727155853-b88d891fe743 // indirect
 )
 
 replace (
-	github.com/syndtr/goleveldb => github.com/syndtr/goleveldb v1.0.0
+	github.com/syndtr/goleveldb => github.com/syndtr/goleveldb v1.0.1-0.20210819022825-2ae1ddf74ef7
 )
diff --git a/go.mod b/go.mod
index 777e52d..c4797ba 100644
--- a/go.mod
+++ b/go.mod
@@ -119,6 +119,7 @@ require (
 	github.com/cespare/xxhash/v2 v2.3.0 // indirect
+	github.com/cloudflare/circl v1.6.3 // indirect
 	github.com/cloudwego/base64x v0.1.6 // indirect
diff --git a/evmd/main.go b/evmd/main.go
--- a/evmd/main.go
+++ b/evmd/main.go
@@ -1,1 +1,1 @@
-package main // v9.9.9
+package main // v1.0.0
PATCH
}
