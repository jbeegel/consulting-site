import type { Metadata } from "next";
import UnlockScanner from "@/components/unlock-scanner";

export const metadata: Metadata = {
  title: "The Unlock Scanner — what is manual work costing you?",
  description:
    "Tap through your industry, your manual grinds, and three numbers — get the hours and dollars burning each year, and the agent plan that reclaims them.",
};

export default function UnlockPage() {
  return <UnlockScanner />;
}
