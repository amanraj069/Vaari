// Vaari permissions. Deny by default: anything not permitted here is refused with 403.
// Principal: User (attrs: role, userId, chcId, farmerId). Resources: Field, Chc.

// A farmer sees and asks about their own fields only.
@id("farmer-own-fields")
permit (principal, action in [Action::"ViewField", Action::"AskWhy"], resource is Field)
when { principal.role == "farmer" && resource.farmerId == principal.farmerId };

// Farmers and facilitators can ask a CHC for a date.
@id("request-field")
permit (principal, action == Action::"RequestField", resource is Chc)
when { principal.role == "farmer" || principal.role == "facilitator" };

// A facilitator sees only the fields they booked.
@id("facilitator-booked-fields")
permit (principal, action in [Action::"ViewField", Action::"AskWhy"], resource is Field)
when { principal.role == "facilitator" && resource.bookedBy == principal.userId };

// An operator works only inside their own CHC.
@id("operator-own-chc")
permit (
  principal,
  action in [
    Action::"ViewBoard", Action::"ViewQueue", Action::"GeneratePlan", Action::"MovePlan", Action::"ApprovePlan",
    Action::"ReportBreakdown", Action::"MarkSown", Action::"ResetDemo"
  ],
  resource is Chc
)
when { principal.role == "operator" && resource.chcId == principal.chcId };

@id("operator-own-fields")
permit (principal, action in [Action::"ViewField", Action::"AskWhy", Action::"ViewFarmerContact"], resource is Field)
when { principal.role == "operator" && resource.chcId == principal.chcId };

// An officer sees aggregates for every CHC, never an individual farmer's contact details.
@id("officer-aggregates")
permit (principal, action == Action::"ViewAggregates", resource is Chc)
when { principal.role == "officer" };

@id("officer-no-contact")
forbid (principal, action == Action::"ViewFarmerContact", resource)
when { principal.role == "officer" };
