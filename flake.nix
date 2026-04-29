{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [ nodejs_20 ];
          shellHook = ''
            echo "jira-mcp dev shell — node $(node --version)"
            export PATH="$PWD/node_modules/.bin:$PATH"
          '';
        };

        # Simple run script - builds and runs in one step
        apps.default = {
          type = "app";
          program = toString (pkgs.writeShellScript "jira-mcp" ''
            cd ${toString ./.}
            ${pkgs.nodejs_20}/bin/npx tsc 2>/dev/null || true
            exec ${pkgs.nodejs_20}/bin/node build/index.js "$@"
          '');
        };
      });
}
