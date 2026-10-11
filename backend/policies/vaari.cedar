// Vaari permissions. Deny by default: anything not permitted here is refused with 403.
// Principals: User (signed in: attrs role, userId, chcId, district) and FarmerPhone (a farmer's
// phone session; attr phone). Resources: Field (attrs chcId, farmerPhone, bookedBy), Chc (attrs
// chcId, district).
// A FarmerPhone principal reads the fields booked with its phone and books new ones for itself.

// A farmer's phone sees and asks about the fields booked with that phone, nothing else. On WhatsApp
// (a Meta-signed message from that number) it may also ask for an earlier date ("I cannot wait
// longer"), which takes effect only after a Confirm tap. The web phone session never asks for it.
@id("farmer-phone-own-fields")
permit (principal is FarmerPhone, action in [Action::"ViewField", Action::"AskWhy", Action::"RequestSooner", Action::"ChangeBooking"], resource is Field)
when { resource.farmerPhone != "" && resource.farmerPhone == principal.phone };

// A registered farmer asks a CHC for a date for a field of their own; the route takes the phone
// from the session, so they can only ever book for themselves.
@id("farmer-phone-request-field")
permit (principal is FarmerPhone, action == Action::"RequestField", resource is Chc);

// Facilitators ask a CHC for a date on a farmer's behalf.
@id("request-field")
permit (principal is User, action == Action::"RequestField", resource is Chc)
when { principal.role == "facilitator" };

// A facilitator sees only the fields they booked, and can reissue those fields' slot links.
@id("facilitator-booked-fields")
permit (principal is User, action in [Action::"ViewField", Action::"AskWhy", Action::"ReissueLink", Action::"ChangeBooking"], resource is Field)
when { principal.role == "facilitator" && resource.bookedBy == principal.userId };

// An operator works only inside their own CHC.
@id("operator-own-chc")
permit (
  principal is User,
  action in [
    Action::"ViewBoard", Action::"ViewQueue", Action::"GeneratePlan", Action::"MovePlan", Action::"ApprovePlan",
    Action::"ReportBreakdown", Action::"MarkSown", Action::"ResetDemo", Action::"ManageMachines", Action::"AdvanceDay"
  ],
  resource is Chc
)
when { principal.role == "operator" && resource.chcId == principal.chcId };

@id("operator-own-fields")
permit (principal is User, action in [Action::"ViewField", Action::"AskWhy", Action::"ViewFarmerContact", Action::"ReissueLink", Action::"ChangeBooking"], resource is Field)
when { principal.role == "operator" && resource.chcId == principal.chcId };

// An officer sees aggregates for the CHCs in their own district, never another district's, and
// never an individual farmer's contact details. An officer with no district sees no centre.
@id("officer-aggregates")
permit (principal is User, action == Action::"ViewAggregates", resource is Chc)
when { principal.role == "officer" && principal.district != "" && resource.district == principal.district };

// An officer allocates machines between centres of their own district: a loan from one centre to
// another (both are checked, so a loan never crosses a district line). They never add or remove a
// centre's own machines; the centre's operator does that.
@id("officer-arrange-loans")
permit (principal is User, action == Action::"ArrangeLoan", resource is Chc)
when { principal.role == "officer" && principal.district != "" && resource.district == principal.district };

@id("officer-no-contact")
forbid (principal is User, action == Action::"ViewFarmerContact", resource)
when { principal.role == "officer" };
