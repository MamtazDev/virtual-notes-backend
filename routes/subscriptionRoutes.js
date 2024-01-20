const express = require("express");
const router = express.Router();
const { authenticateUser } = require("../middleware/auth");
const User = require("../models/User");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Create a new subscription
router.post("/create-subscription", authenticateUser, async (req, res) => {
  const { email, paymentMethodId, productId, billingCycle } = req.body;

  const productToPriceId = {
    prod_Oz7rQ78PYkbCNq: "price_1OB9bJCLw8f7mw14IuF1j25e",
    prod_Oz7q5ksiXFH7mn_monthly: "price_1OB9ahCLw8f7mw14wSKDDlTZ",
    prod_Oz7q5ksiXFH7mn_yearly: "price_1OB9ahCLw8f7mw14cZotT8eg",
  };

  const stripeIdToPlanName = {
    prod_Oz7rQ78PYkbCNq: "free_trial",
    prod_Oz7q5ksiXFH7mn: "student_plan",
  };

  const priceId =
    productToPriceId[`${productId}_${billingCycle}`] ||
    productToPriceId[productId];

  if (!priceId) {
    return res
      .status(400)
      .json({ error: "Invalid product ID or billing cycle" });
  }

  try {
    let customer = await stripe.customers.list({ email: email, limit: 1 });
    if (customer.data.length === 0) {
      customer = await stripe.customers.create({
        payment_method: paymentMethodId,
        email: email,
        invoice_settings: { default_payment_method: paymentMethodId },
      });
    } else {
      customer = customer.data[0];
    }

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      expand: ["latest_invoice.payment_intent"],
    });

    const user = await User.findOne({ email: email });
    if (user) {
      user.planId = stripeIdToPlanName[productId] || productId;
      user.subscriptionId = subscription.id;
      await user.save();

      res.status(200).json({
        subscription: subscription,
        planId: user.planId,
      });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch (error) {
    console.error("Error creating subscription:", error);
    res.status(500).json({ error: "Error processing subscription" });
  }
});

// Cancel a subscription
router.post("/api/cancel-subscription", authenticateUser, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const trialPeriod = 7 * 24 * 60 * 60 * 1000;
    const studentPlanPeriod = 30 * 24 * 60 * 60 * 1000;
    const now = new Date();
    let endDate;
    let message = "";

    if (user.planId === "free_trial") {
      const trialEnd = new Date(
        user.subscriptionStartDate.getTime() + trialPeriod
      );
      if (now < trialEnd) {
        user.isSubscriptionActive = false;
        user.subscriptionEndDate = trialEnd;
        await user.save();
        message =
          "Trial cancellation scheduled. Access will be revoked after the trial period ends.";
      } else {
        message = "Trial period has already ended.";
      }
    } else if (user.planId === "student_plan") {
      const planEnd = new Date(
        user.subscriptionStartDate.getTime() + studentPlanPeriod
      );
      if (now < planEnd) {
        const stripeResponse = await stripe.subscriptions.del(
          user.subscriptionId
        );
        if (stripeResponse && stripeResponse.deleted) {
          user.subscriptionEndDate = planEnd;
          message =
            "Subscription cancellation scheduled. Access will be revoked after the 30-day period.";
        } else {
          message = "Failed to cancel the subscription via Stripe.";
        }
      } else {
        message = "Subscription period has already ended.";
      }
    } else {
      message = "No active trial or subscription to cancel.";
    }

    await user.save();
    res.status(200).json({
      message,
      subscriptionEndDate: endDate ? endDate.toISOString() : null,
    });
  } catch (error) {
    console.error("Error cancelling subscription: ", error);
    res.status(500).json({ message: "Failed to cancel subscription" });
  }
});

// Update a subscription (e.g., changing the plan)
router.put("/:subscriptionId", authenticateUser, async (req, res) => {
  const { subscriptionId } = req.params;
  const { newPlanId } = req.body;

  try {
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false,
      items: [
        {
          id: subscription.items.data[0].id,
          plan: newPlanId,
        },
      ],
    });

    // Update user model if needed
    const user = await User.findById(req.user.id);
    user.plan = newPlanId; // Update the user's plan
    await user.save();

    res
      .status(200)
      .json({ message: "Subscription updated successfully", subscription });
  } catch (error) {
    console.error("Error updating subscription:", error);
    res
      .status(500)
      .json({ message: "Failed to update subscription", error: error.message });
  }
});

// Retrieve a subscription
router.get("/:subscriptionId", authenticateUser, async (req, res) => {
  const { subscriptionId } = req.params;

  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    res.status(200).json(subscription);
  } catch (error) {
    console.error("Error retrieving subscription:", error);
    res.status(500).json({
      message: "Failed to retrieve subscription",
      error: error.message,
    });
  }
});

// Export the router
module.exports = router;
