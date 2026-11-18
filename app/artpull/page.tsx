import type { Metadata } from "next";
import ArtPull from "@/components/artpull";

export const metadata: Metadata = {
  title: "Art Pull — scan the traveler, pull the art",
  description: "Photograph or scan a NetSuite work-order traveler; the right art file is found in Dropbox and staged for the press.",
};

export default function ArtPullPage() {
  return <ArtPull />;
}
