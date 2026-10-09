// Vaari permissions. Deny by default: anything not permitted here is refused with 403.
// Principals: User (signed in: attrs role, userId, chcId) and FarmerPhone (a farmer's phone
// session; attr phone). Resources: Field (attrs chcId, farmerPhone, bookedBy), Chc (attr chcId).
// Farmers have no account: a FarmerPhone principal can only read fields booked with its phone.

// A farmer's phone sees and asks about the fields booked with that phone, nothing else. On WhatsApp
// (a Meta-signed message from that number) it may also ask for an earlier date ("I cannot wait
// longer"), which takes effect only after a Confirm tap. The web phone session never asks for it.
@id("farmer-phone-own-fields")
permit (principal is FarmerPhone, action in [Action::"ViewField", Action::"AskWhy", Action::"RequestSooner"], resource is Field)
when { resource.farmerPhone != "" && resource.farmerPhone == principal.phone };

// Facilitators ask a CHC for a date on a farmer's behalf.
@id("request-field")
permit (principal is User, action == Action::"RequestField", resource is Chc)
when { principal.role == "facilitator" };

// A facilitator sees only the fields they booked, and can reissue those fields' slot links.
@id("facilitator-booked-fields")
permit (principal is User, action in [Action::"ViewField", Action::"AskWhy", Action::"ReissueLink"], resource is Field)
when { principal.role == "facilitator" && resource.bookedBy == principal.userId };

// An operator works only inside their own CHC.
@id("operator-own-chc")
permit (
  principal is User,
  action in [
    Action::"ViewBoard", Action::"ViewQueue", Action::"GeneratePlan", Action::"MovePlan", Action::"ApprovePlan",
    Action::"ReportBreakdown", Action::"MarkSown", Action::"ResetDemo"
  ],
  resource is Chc
)
when { principal.role == "operator" && resource.chcId == principal.chcId };

@id("operator-own-fields")
permit (principal is User, action in [Action::"ViewField", Action::"AskWhy", Action::"ViewFarmerContact", Action::"ReissueLink"], resource is Field)
when { principal.role == "operator" && resource.chcId == principal.chcId };

// An officer sees aggregates for every CHC, never an individual farmer's contact details.
@id("officer-aggregates")
permit (principal is User, action == Action::"ViewAggregates", resource is Chc)
when { principal.role == "officer" };

@id("officer-no-contact")
forbid (principal is User, action == Action::"ViewFarmerContact", resource)
when { principal.role == "officer" };
