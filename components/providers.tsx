"use client";

import { getEmbeddedConnectedWallet, PrivyProvider, usePrivy, useWallets, type PrivyClientConfig } from "@privy-io/react-auth";
import { useEffect } from "react";
import { mainnet } from "viem/chains";
import { PRIVY_APP_ID } from "@/lib/privy";
import { setChainProvider } from "@/lib/robinhood-market";
import { YeeldProvider, useYeeld } from "@/lib/store";

const privyConfig: PrivyClientConfig = {
  loginMethods: ["wallet", "email", "google", "twitter"],
  appearance: {
    theme: "dark" as const,
    accentColor: "#22A3FF" as const,
    landingHeader: "Connect a wallet",
    loginMessage: "Use an external wallet, or email to create one.",
    showWalletLoginFirst: true,
    walletChainType: "ethereum-only" as const,
    walletList: [
      "detected_ethereum_wallets",
      "metamask",
      "coinbase_wallet",
      "rainbow",
      "wallet_connect",
      "phantom",
      "okx_wallet",
      "uniswap",
      "zerion",
      "robinhood_wallet",
      "bitget_wallet",
      "kraken_wallet",
      "bybit_wallet",
      "safe",
    ],
  },
  embeddedWallets: {
    ethereum: { createOnLogin: "users-without-wallets" as const },
  },
  // Login only needs an address. SIWE on custom chain 4663 is rejected.
  defaultChain: mainnet,
  supportedChains: [mainnet],
};

function WalletBridge() {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const { setWallet } = useYeeld();
  const embedded = getEmbeddedConnectedWallet(wallets);
  const connected = embedded ?? wallets[0];
  const address = connected?.address ?? (authenticated ? user?.wallet?.address : undefined);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      setWallet(null);
      setChainProvider(null);
      return;
    }
    if (address) setWallet(address);
  }, [ready, authenticated, address, setWallet]);

  useEffect(() => {
    if (!authenticated || !connected) {
      setChainProvider(null);
      return;
    }
    let stop = false;
    connected
      .getEthereumProvider()
      .then((provider) => {
        if (!stop) setChainProvider(provider, connected.walletClientType);
      })
      .catch(() => {
        if (!stop) setChainProvider(null);
      });
    return () => {
      stop = true;
    };
  }, [authenticated, connected]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const app = (
    <YeeldProvider>
      {PRIVY_APP_ID ? <WalletBridge /> : null}
      {children}
    </YeeldProvider>
  );
  if (!PRIVY_APP_ID) return app;
  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
      {app}
    </PrivyProvider>
  );
}
