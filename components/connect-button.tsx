"use client";

import { useLogin, usePrivy } from "@privy-io/react-auth";
import { shortAddr } from "@/lib/format";
import { PRIVY_APP_ID } from "@/lib/privy";
import { useYeeld } from "@/lib/store";

const MISSING_APP = "Add NEXT_PUBLIC_PRIVY_APP_ID to .env.local, allow http://localhost:3000 in the Privy dashboard, then restart the dev server.";

export function ConnectButton({ className = "btn-accent", label = "Connect" }: { className?: string; label?: string }) {
  if (!PRIVY_APP_ID) return <Unconfigured className={className} label={label} />;
  return <Live className={className} label={label} />;
}

function Unconfigured({ className, label }: { className: string; label: string }) {
  const { state, setWallet, notify } = useYeeld();
  if (state.wallet) {
    return (
      <button className="btn" onClick={() => setWallet(null)}>
        {shortAddr(state.wallet)}
      </button>
    );
  }
  return (
    <button className={className} onClick={() => notify(MISSING_APP)}>
      {label}
    </button>
  );
}

function Live({ className, label }: { className: string; label: string }) {
  const { state, setWallet, notify } = useYeeld();
  const { ready, logout } = usePrivy();
  const { login } = useLogin({
    onError: (error) => notify(error?.toString() || "Wallet login failed"),
  });
  const wallet = state.wallet;

  return (
    <button
      className={wallet ? "btn" : className}
      disabled={!ready}
      onClick={() => {
        if (wallet) {
          setWallet(null);
          void logout();
          return;
        }
        login();
      }}
    >
      {wallet ? shortAddr(wallet) : ready ? label : "…"}
    </button>
  );
}
