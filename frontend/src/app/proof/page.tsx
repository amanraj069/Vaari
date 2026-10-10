/** /proof, public: the simulator's evidence for visitors and judges (ProofView); signed-in people also see it in their dashboard. */
import { PageMain } from "@/components/page-shell";
import { TopBar } from "@/components/top-bar";
import { ProofView } from "@/components/views/proof-view";

export default function ProofPage() {
  return (
    <>
      <TopBar />
      <PageMain>
        <ProofView />
      </PageMain>
    </>
  );
}
