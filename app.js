```javascript
    const registrationRef = doc(db, "registrations", registrationId);

    joinStage = "Tournament Information Read";
    const selectedTournament = tournamentCache.find((item) => item.id === tournamentId);
    if (!selectedTournament) throw new Error("Tournament তালিকায় পাওয়া যায়নি।");

    const mode = getTournamentMode(selectedTournament.data);
    const requiredPlayers = mode === "Duo" ? 2 : mode === "Squad" ? 4 : 1;
    const players = [];

    for (let i = 1; i <= requiredPlayers; i++) {
      const gameUsername = String(data[`player${i}Name`] || "").trim();
      const uid = String(data[`player${i}Uid`] || "").trim();
      if (!gameUsername || !/^[0-9]{5,20}$/.test(uid)) {
        throw new Error(`Player ${i}-এর Game Name অথবা UID সঠিক নয়।`);
      }
      players.push({ slot: i, gameUsername, uid });
    }

    joinStage = "Wallet Ledger Read";
    const ledgerSnap = await getDocs(query(
      collection(db, "paymentRequests"),
      where("userId", "==", currentUser.uid)
    ));
    const feeRef = doc(collection(db, "paymentRequests"));

    joinStage = "Tournament Transaction";
    await runTransaction(db, async (tx) => {
      const tournamentSnap = await tx.get(tournamentRef);
      if (!tournamentSnap.exists()) throw new Error("Tournament পাওয়া যায়নি।");

      const existingSnap = await tx.get(registrationRef);
      if (existingSnap.exists()) throw new Error("এই Tournament-এ তুমি আগে Join করেছ।");

      const tournament = tournamentSnap.data();
      if (String(tournament.status || "published").toLowerCase() !== "published") {
        throw new Error("এই Tournament এখন Join করা যাচ্ছে না।");
      }

      const liveMode = getTournamentMode(tournament);
      const liveCount = liveMode === "Duo" ? 2 : liveMode === "Squad" ? 4 : 1;
      if (liveMode !== mode || players.length !== liveCount) {
        throw new Error("Tournament Mode পরিবর্তিত হয়েছে। ফর্ম আবার খুলে তথ্য দাও।");
      }

      const fee = Number(tournament.entryFee || 0);
      const joined = Number(tournament.joined || 0);
      const slots = Number(tournament.slots || 0);
      if (!Number.isFinite(fee) || fee < 0) throw new Error("Tournament Entry Fee সঠিক নয়।");
      if (!Number.isInteger(joined) || !Number.isInteger(slots) || slots < 1) {
        throw new Error("Tournament Slot তথ্য সঠিক নয়।");
      }
      if (joined >= slots) throw new Error("এই Tournament-এর Slot পূর্ণ হয়ে গেছে।");

      let balance = 0;
      ledgerSnap.forEach((item) => {
        const payment = item.data();
        const amount = Number(payment.amount || 0);
        if (payment.status === "approved") {
          if (payment.type === "deposit" || payment.type === "tournament_prize") balance += amount;
          if (payment.type === "tournament_fee" || payment.type === "withdraw") balance -= amount;
        } else if (payment.type === "withdraw" && payment.status === "pending") {
          balance -= amount;
        }
      });
      if (balance < fee) {
        throw new Error(`Wallet Balance পর্যাপ্ত নয়। প্রয়োজন ৳${money(fee)}, আছে ৳${money(balance)}।`);
      }

      joinStage = "Registration Create";
      tx.set(registrationRef, {
        userId: currentUser.uid,
        tournamentId,
        tournamentTitle: tournament.title || "",
        mode: liveMode,
        playerName: players[0].gameUsername,
        gameUsername: players[0].gameUsername,
        uid: players[0].uid,
        players,
        teamName: liveMode === "Solo" ? "" : teamName,
        status: "approved",
        createdAt: serverTimestamp(),
        approvedAt: serverTimestamp(),
        autoJoined: true
      });

      joinStage = "Tournament Joined Update";
      tx.update(tournamentRef, { joined: joined + 1 });

      if (fee > 0) {
        joinStage = "Entry Fee Ledger Create";
        tx.set(feeRef, {
          userId: currentUser.uid,
          type: "tournament_fee",
          amount: fee,
          status: "approved",
          tournamentId,
          method: "Wallet",
          reference: "Automatic Tournament Entry Fee",
          createdAt: serverTimestamp()
        });
      }
    });

    form.reset();
    updateRegistrationPlayerFields();
    showMessage("সফলভাবে Tournament Join হয়েছে। Entry Fee Wallet থেকে কেটে নেওয়া হয়েছে।");
    await loadPlayerData();
    await loadTournaments();
  } catch (error) {
    console.error("TOURNAMENT JOIN ERROR:", error);
    console.error("ERROR STAGE:", joinStage);
    console.error("ERROR CODE:", error.code);
    showMessage(`${joinStage} ব্যর্থ হয়েছে: ${error.message || "Unknown Error"}`, true);
  }
});

// LOAD PLAYER MATCHES
async function loadPlayerData() {
  if (!currentUser) return;

  try {
    const registrationSnap = await getDocs(query(
      collection(db, "registrations"),
      where("userId", "==", currentUser.uid)
    ));

    if ($("#myMatchesList")) {
      $("#myMatchesList").innerHTML = registrationSnap.empty
        ? "এখনো কোনো Tournament-এ Registration করোনি।"
        : registrationSnap.docs.map((item) => {
            const r = item.data();

            return `
              <div class="match-row">
                <b>${escapeHTML(r.tournamentTitle || r.tournamentId)}</b>
                <p>Player: ${escapeHTML(r.playerName)}</p>
                ${Array.isArray(r.players) && r.players.length
                  ? r.players.map((member, index) => `
                    <p>Player ${index + 1}: ${escapeHTML(member.gameUsername || "-")}</p>
                    <p>UID: ${escapeHTML(member.uid || "-")}</p>
                  `).join("")
                  : `<p>Game Username: ${escapeHTML(r.gameUsername || "-")}</p>
                     <p>UID: ${escapeHTML(r.uid || "-")}</p>`}
                ${r.status === "approved" && (r.roomId || r.roomPassword) ? `
                  <div style="margin-top:16px;padding:16px;border:1px solid rgba(0,229,255,.35);border-radius:16px;background:linear-gradient(135deg,rgba(0,229,255,.10),rgba(15,24,43,.96));box-shadow:0 8px 24px rgba(0,0,0,.22)">
                    <div style="display:flex;align-items:center;gap:9px;margin-bottom:14px">
                      <span style="font-size:22px">🎮</span>
                      <div>
                        <div style="font-weight:800;font-size:15px;letter-spacing:.5px">MATCH ROOM DETAILS</div>
                        <small style="color:#7eeeff">শুধু Approved Player-এর জন্য</small>
                      </div>
                    </div>

                    ${r.roomId ? `
                      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 12px;margin-bottom:9px;border-radius:11px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.08)">
                        <div style="min-width:0">
                          <small style="display:block;color:#9baec7;font-size:11px;margin-bottom:4px">ROOM ID</small>
                          <strong style="font-size:17px;color:#fff;letter-spacing:1px;overflow-wrap:anywhere">${escapeHTML(r.roomId)}</strong>
                        </div>
                        <button type="button" data-copy-value="${escapeHTML(r.roomId)}" style="flex-shrink:0;border:1px solid rgba(0,229,255,.5);border-radius:9px;background:rgba(0,229,255,.12);color:#5eeeff;padding:9px 12px;font-weight:800;cursor:pointer">▢ COPY</button>
                      </div>` : ""}

                    ${r.roomPassword ? `
                      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 12px;border-radius:11px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.08)">
                        <div style="min-width:0">
                          <small style="display:block;color:#9baec7;font-size:11px;margin-bottom:4px">ROOM PASSWORD</small>
                          <strong style="font-size:17px;color:#fff;letter-spacing:1px;overflow-wrap:anywhere">${escapeHTML(r.roomPassword)}</strong>
                        </div>
                        <button type="button" data-copy-value="${escapeHTML(r.roomPassword)}" style="flex-shrink:0;border:1px solid rgba(0,229,255,.5);border-radius:9px;background:rgba(0,229,255,.12);color:#5eeeff;padding:9px 12px;font-weight:800;cursor:pointer">▢ COPY</button>
                      </div>` : ""}

                    <p style="margin:12px 0 0;color:#a9bed5;font-size:12px">⚠️ Room ID ও Password অন্য কারও সঙ্গে শেয়ার করবে না।</p>
                  </div>` : ""}
                <span class="status-tag ${escapeHTML(r.status)}">${escapeHTML(r.status)}</span>
              </div>
            `;
          }).join("");
    }

    const paymentSnap = await getDocs(query(
      collection(db, "paymentRequests"),
      where("userId", "==", currentUser.uid)
    ));

    let balance = 0;

    paymentSnap.forEach((item) => {
      const p = item.data();

      if (p.status === "approved") {
        if (p.type === "deposit" || p.type === "tournament_prize") balance += Number(p.amount || 0);
        if (p.type === "tournament_fee" || p.type === "withdraw") {
          balance -= Number(p.amount || 0);
        }
      }
    });

    // Pending withdrawal requests reserve funds until Admin rejects or approves.
    paymentSnap.forEach((item) => {
      const p = item.data();
      if (p.type === "withdraw" && p.status === "pending") {
        balance -= Number(p.amount || 0);
      }
    });

    if ($("#balance")) {
      $("#balance").textContent = "৳ " + money(Math.max(0, balance));
    }

    if ($("#paymentRows")) {
      const payments = paymentSnap.docs
        .map((item) => item.data())
        .sort((a, b) => {
          const at = a.createdAt?.seconds || 0;
          const bt = b.createdAt?.seconds || 0;
          return bt - at;
        });

      $("#paymentRows").innerHTML = payments.length
        ? payments.map((p) => `
            <tr>
              <td>${escapeHTML(p.type)}</td>
              <td>৳${money(p.amount)}</td>
              <td>${escapeHTML(p.method || "Wallet")}</td>
              <td><span class="status-tag ${escapeHTML(p.status)}">${escapeHTML(p.status)}</span></td>
            </tr>
          `).join("")
        : '<tr><td colspan="4">কোনো লেনদেন নেই।</td></tr>';
    }
  } catch (error) {
    console.error("Player data error:", error);
    showMessage("Player Data লোড হয়নি।", true);
  }
}

// COPY ROOM ID / PASSWORD (delegated so dynamically rendered match cards work)
document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy-value]");
  if (!button) return;

  const value = button.getAttribute("data-copy-value") || "";
  if (!value) return;

  const originalText = button.textContent;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
    } else {
      const temporaryInput = document.createElement("textarea");
      temporaryInput.value = value;
      temporaryInput.setAttribute("readonly", "");
      temporaryInput.style.position = "fixed";
      temporaryInput.style.opacity = "0";
      document.body.appendChild(temporaryInput);
      temporaryInput.select();
      const copied = document.execCommand("copy");
      temporaryInput.remove();
      if (!copied) throw new Error("Copy command failed");
    }

    button.textContent = "✓ COPIED";
    button.style.background = "rgba(34,197,94,.16)";
    button.style.borderColor = "rgba(34,197,94,.65)";
    button.style.color = "#86efac";
    showMessage("Room তথ্য কপি হয়েছে!");

    setTimeout(() => {
      button.textContent = originalText;
      button.style.background = "rgba(0,229,255,.12)";
      button.style.borderColor = "rgba(0,229,255,.5)";
      button.style.color = "#5eeeff";
    }, 1600);
  } catch (error) {
    console.error("Room copy error:", error);
    showMessage("কপি করা যায়নি। হাতে সিলেক্ট করে কপি করো।", true);
  }
});

// COPY PAYMENT NUMBER
$("#copyNumber")?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText("01346022330");
    showMessage("পেমেন্ট নম্বর কপি হয়েছে।");
  } catch {
    showMessage("নম্বর কপি করা যায়নি। 01346022330", true);
  }
});

// PAYMENT REQUEST
$("#paymentForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser) {
    showMessage("Deposit করতে আগে Login করো।", true);
    page("account");
    return;
  }

  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const amount = Number(data.amount);
  const reference = String(data.reference || "").trim();

  if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
    showMessage("সঠিক Amount লিখো।", true);
    return;
  }

  if (reference.length < 4) {
    showMessage("সঠিক Transaction ID দাও।", true);
    return;
  }

  try {
    await addDoc(collection(db, "paymentRequests"), {
      userId: currentUser.uid,
      type: "deposit",
      amount,
      method: String(data.method || "bKash"),
      reference,
      status: "pending",
      createdAt: serverTimestamp()
    });

    form.reset();
    showMessage("Deposit Request পাঠানো হয়েছে। Admin যাচাই করবেন।");
    await loadPlayerData();
    if (isAdmin) await loadAdminData();
  } catch (error) {
    console.error("Payment request error:", error);
    showMessage(error.message, true);
  }
});

// WITHDRAW REQUEST
$("#withdrawForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();$("#withdrawForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) {
    showMessage("Withdraw করতে আগে Login করো।", true);
    page("account");
    return;
  }

  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const amount = Number(data.amount);
  const accountNumber = String(data.accountNumber || "").trim();

  if (!Number.isFinite(amount) || amount < 1 || amount > 100000 ||
      !/^01[3-9][0-9]{8}$/.test(accountNumber)) {
    showMessage("সঠিক Amount ও ১১ সংখ্যার বাংলাদেশি মোবাইল নম্বর দাও।", true);
    return;
  }

  try {
    const ledger = await getDocs(query(
      collection(db, "paymentRequests"),
      where("userId", "==", currentUser.uid)
    ));
    let available = 0;
    ledger.forEach((item) => {
      const p = item.data();
      if (p.status === "approved") {
        if (p.type === "deposit" || p.type === "tournament_prize") available += Number(p.amount || 0);
        if (p.type === "withdraw" || p.type === "tournament_fee") available -= Number(p.amount || 0);
      } else if (p.type === "withdraw" && p.status === "pending") {
        available -= Number(p.amount || 0);
      }
    });
    if (amount > available) throw new Error(`পর্যাপ্ত ব্যালেন্স নেই। Available: ৳${money(Math.max(0, available))}`);

    await addDoc(collection(db, "paymentRequests"), {
      userId: currentUser.uid,
      type: "withdraw",
      amount,
      method: String(data.method),
      accountNumber,
      status: "pending",
      createdAt: serverTimestamp()
    });
    form.reset();
    showMessage("Withdraw request পাঠানো হয়েছে। Admin Review করবেন।");
    await loadPlayerData();
    if (isAdmin) await loadAdminData();
  } catch (error) {
    console.error("Withdraw request error:", error);
    showMessage(error.message || "Withdraw request পাঠানো যায়নি।", true);
  }
});

// DISPLAY NAME ONLY (profile photo upload is not included)
$("#profileForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;
  const displayName = String(new FormData(event.currentTarget).get("displayName") || "").trim();
  if (!displayName || displayName.length > 40) {
    showMessage("Display Name ১-৪০ অক্ষরের মধ্যে দাও।", true);
    return;
  }
  try {
    await updateProfile(currentUser, { displayName });
    await setDoc(doc(db, "users", currentUser.uid), {
      displayName, updatedAt: serverTimestamp()
    }, { merge: true });
    if ($("#session")) $("#session").textContent = `Login করা হয়েছে: ${displayName}`;
    showMessage("Display Name আপডেট হয়েছে।");
  } catch (error) {
    console.error("Profile update error:", error);
    showMessage(error.message || "Profile আপডেট হয়নি।", true);
  }
});

// LOAD ADMIN DATA
async function loadAdminData() {
  if (!(await checkAdmin())) return;

  try {
    const paymentSnap = await getDocs(query(
      collection(db, "paymentRequests"),
      where("status", "==", "pending")
    ));

    if ($("#adminPayments")) {
      $("#adminPayments").innerHTML = paymentSnap.empty
        ? '<tr><td colspan="3">কোনো Pending Payment নেই।</td></tr>'
        : paymentSnap.docs.map((item) => {
            const p = item.data();

            return `
              <tr>
                <td>${escapeHTML(p.userId)}</td>
                <td>
                  ৳${money(p.amount)}<br>
                  ${escapeHTML(p.method)}<br>
                  ID: ${escapeHTML(p.reference)}
                </td>
                <td>
                  <button class="small-btn approve" onclick="window.reviewPayment('${item.id}','approved')">Approve</button>
                  <button class="small-btn reject" onclick="window.reviewPayment('${item.id}','rejected')">Reject</button>
                </td>
              </tr>
            `;
          }).join("");
    }

    const withdrawalSnap = await getDocs(query(
      collection(db, "paymentRequests"),
      where("type", "==", "withdraw"),
      where("status", "==", "pending")
    ));

    if ($("#adminWithdrawals")) {
      $("#adminWithdrawals").innerHTML = withdrawalSnap.empty
        ? '<tr><td colspan="3">কোনো Pending Withdraw নেই।</td></tr>'
        : withdrawalSnap.docs.map((item) => {
            const w = item.data();
            return `
              <tr>
                <td>${escapeHTML(w.userId)}</td>
                <td>৳${money(w.amount)}<br>${escapeHTML(w.method || "")}<br>${escapeHTML(w.accountNumber || "")}</td>
                <td>
                  <button class="small-btn approve" onclick="window.reviewPayment('${item.id}','approved')">Approve</button>
                  <button class="small-btn reject" onclick="window.reviewPayment('${item.id}','rejected')">Reject</button>
                </td>
              </tr>`;
          }).join("");
    }

    // Show ALL registrations (pending + approved + rejected), grouped by tournament.
    const registrationSnap = await getDocs(collection(db, "registrations"));

    if ($("#adminRegistrations")) {
      if (registrationSnap.empty) {
        $("#adminRegistrations").innerHTML =
          '<tr><td colspan="5">এখনো কোনো Tournament-এ কেউ Join করেনি।</td></tr>';
      } else {
        const registrations = registrationSnap.docs.map((item) => ({
          id: item.id,
          data: item.data()
        }));

        // Group by tournamentId so every player's details appear under the correct tournament.
        const groups = new Map();
        registrations.forEach(({ id, data }) => {
          const tournamentId = String(data.tournamentId || "unknown");
          if (!groups.has(tournamentId)) groups.set(tournamentId, []);
          groups.get(tournamentId).push({ id, data });
        });

        const tournamentNames = new Map(
          tournamentCache.map(({ id, data }) => [id, data.title || id])
        );

        const html = [...groups.entries()].map(([tournamentId, players]) => {
          const tournamentTitle = tournamentNames.get(tournamentId)
            || players[0]?.data.tournamentTitle
            || tournamentId;

          const playerRows = players.map(({ id, data: r }) => {
            const status = String(r.status || "pending");
            const action = status === "pending"
              ? `<button class="small-btn approve" type="button" onclick="window.approveRegistration('${id}')">Approve</button>
                 <button class="small-btn reject" type="button" onclick="window.rejectRegistration('${id}')">Reject</button>`
              : `<span class="status-tag ${escapeHTML(status)}">${escapeHTML(status)}</span>`;

            return `
              <tr>
                <td>${escapeHTML(r.teamName || r.playerName || "-")}</td>
                <td>${Array.isArray(r.players) && r.players.length
                  ? r.players.map((member, index) => `P${index + 1}: ${escapeHTML(member.gameUsername || "-")}`).join("<br>")
                  : escapeHTML(r.gameUsername || "-")}</td>
                <td>${Array.isArray(r.players) && r.players.length
                  ? r.players.map((member, index) => `P${index + 1}: ${escapeHTML(member.uid || "-")}`).join("<br>")
                  : escapeHTML(r.uid || "-")}</td>
                <td><code>${escapeHTML(r.userId || "Firebase UID নেই")}</code></td>
                <td>${action}</td>
              </tr>
            `;
          }).join("");

          return `
  <tr class="admin-tournament-group">
    <td colspan="5">
      <strong>🏆 ${escapeHTML(tournamentTitle)}</strong>
      <small> — ${players.length} জন Player</small>
      <br>
      <small>Tournament ID:
        <code>${escapeHTML(tournamentId)}</code>
      </small>
    </td>
  </tr>
  ${playerRows}
`;
        }).join("");

        $("#adminRegistrations").innerHTML = html;
      }
    }

  } catch (error) {
    console.error("Admin data error:", error);
      showMessage("Admin Data লোড হয়নি।", true);
  }
}

// ADMIN APPROVE / REJECT PAYMENT
window.reviewPayment = async (paymentId, status) => {
  if (!(await checkAdmin())) {
    showMessage("Admin permission নেই।", true);
    return;
        }

  if (!["approved", "rejected"].includes(status)) return;

  try {
    const ref = doc(db, "paymentRequests", paymentId);

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);

      if (!snap.exists()) throw new Error("Payment পাওয়া যায়নি।");
      if (snap.data().status !== "pending") {
        throw new Error("Payment আগে Review করা হয়েছে।");
      }

      const request = snap.data();
      if (request.type === "withdraw" && status === "approved") {
        const userPayments = await getDocs(query(
          collection(db, "paymentRequests"),
          where("userId", "==", request.userId)
        ));
        let available = 0;
        userPayments.forEach((entry) => {
          if (entry.id === paymentId) return;
          const p = entry.data();
          if (p.status === "approved") {
            if (p.type === "deposit" || p.type === "tournament_prize") available += Number(p.amount || 0);
            if (p.type === "withdraw" || p.type === "tournament_fee") available -= Number(p.amount || 0);
          } else if (p.type === "withdraw" && p.status === "pending") {
            available -= Number(p.amount || 0);
          }
        });
        if (Number(request.amount || 0) > available) {
          throw new Error("এই Withdraw Approve করার মতো পর্যাপ্ত Available Balance নেই।");
        }
      }

      tx.update(ref, {
        status,
        reviewedAt: serverTimestamp(),
        reviewedBy: auth.currentUser.uid
      });
    });

    showMessage(
      status === "approved"
        ? "Payment Approve হয়েছে।"
        : "Payment Reject হয়েছে।"
    );

    await loadAdminData();
    if (currentUser) await loadPlayerData();
  } catch (error) {
    console.error("Review payment error:", error);
    showMessage(error.message, true);
  }
};

// ADMIN APPROVE REGISTRATION + ENTRY FEE
window.approveRegistration = async (registrationId) => {
  if (!(await checkAdmin())) {
    showMessage("Admin permission নেই।", true);
    return;
  }

  try {
    const registrationRef = doc(db, "registrations", registrationId);
    const registrationSnap = await getDoc(registrationRef);

    if (!registrationSnap.exists()) {
      throw new Error("Registration পাওয়া যায়নি।");
    }

    const registration = registrationSnap.data();

    if (registration.status !== "pending") {
      throw new Error("Registration আগে Review হয়েছে।");
    }

    const tournamentRef = doc(db, "tournaments", registration.tournamentId);
    const tournamentSnap = await getDoc(tournamentRef);

    if (!tournamentSnap.exists()) {
      throw new Error("Tournament পাওয়া যায়নি।");
    }

    const fee = Number(tournamentSnap.data().entryFee || 0);

    // Read approved wallet ledger entries.
    const ledgerSnap = await getDocs(query(
      collection(db, "paymentRequests"),
      where("userId", "==", registration.userId)
    ));

    let balance = 0;

    ledgerSnap.forEach((item) => {
      const p = item.data();

      if (p.status === "approved") {
        if (p.type === "deposit" || p.type === "tournament_prize") balance += Number(p.amount || 0);
        if (p.type === "tournament_fee" || p.type === "withdraw") {
          balance -= Number(p.amount || 0);
        }
      }
    });

    if (balance < fee) {
      throw new Error(
        `Player-এর Wallet Balance পর্যাপ্ত নয়। বর্তমান Balance: ৳${money(balance)}`
      );
    }

    await runTransaction(db, async (tx) => {
      const latestReg = await tx.get(registrationRef);
      const latestTournament = await tx.get(tournamentRef);

      if (!latestReg.exists() || !latestTournament.exists()) {
        throw new Error("Registration অথবা Tournament পাওয়া যায়নি।");
      }

      if (latestReg.data().status !== "pending") {
        throw new Error("Registration ইতিমধ্যে Review হয়েছে।");
      }

      const t = latestTournament.data();
      const joined = Number(t.joined || 0);
      const slots = Number(t.slots || 0);

      if (slots > 0 && joined >= slots) {
        throw new Error("Tournament Slot পূর্ণ হয়ে গেছে।");
      }

      tx.update(registrationRef, {
        status: "approved",
        approvedAt: serverTimestamp(),
        approvedBy: auth.currentUser.uid
      });

      tx.update(tournamentRef, {
        joined: joined + 1
      });

      if (fee > 0) {
        const debitRef = doc(collection(db, "paymentRequests"));

        tx.set(debitRef, {
          userId: registration.userId,
          type: "tournament_fee",
          amount: fee,
          status: "approved",
          tournamentId: registration.tournamentId,
          method: "Wallet",
          reference: "Tournament Entry Fee",
          createdAt: serverTimestamp(),
          reviewedBy: auth.currentUser.uid
        });
      }
    });

    showMessage("Registration Approve হয়েছে।");
    await loadAdminData();
    if (currentUser) await loadPlayerData();
    await loadTournaments();
  } catch (error) {
    console.error("Approve registration error:", error);
    showMessage(error.message, true);
  }
};
// ADMIN REJECT REGISTRATION
window.rejectRegistration = async (registrationId) => {
  if (!(await checkAdmin())) {
    showMessage("Admin permission নেই।", true);
    return;
  }

  try {
    const ref = doc(db, "registrations", registrationId);

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);

      if (!snap.exists()) throw new Error("Registration পাওয়া যায়নি।");

      if (snap.data().status !== "pending") {
        throw new Error("Registration আগে Review হয়েছে।");
      }

      tx.update(ref, {
        status: "rejected",
        reviewedAt: serverTimestamp(),
        reviewedBy: auth.currentUser.uid
      });
    });

    showMessage("Registration Reject হয়েছে।");
    await loadAdminData();
    if (currentUser) await loadPlayerData();
  } catch (error) {
    console.error("Reject registration error:", error);
    showMessage(error.message, true);
  }
};

// ADMIN: SEND ROOM DETAILS TO APPROVED PLAYERS ONLY
document.addEventListener("submit", async (event) => {
  if (event.target.id !== "roomDetailsForm") return;
  event.preventDefault();
  if (!(await checkAdmin())) {
    showMessage("শুধু Admin Room ID ও Password দিতে পারবে।", true);
    return;
  }

  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  const tournamentId = String(data.tournamentId || "").trim();
  const roomId = String(data.roomId || "").trim();
  const roomPassword = String(data.roomPassword || "").trim();

  if (!tournamentId || !roomId || !roomPassword) {
    showMessage("Tournament, Room ID ও Password পূরণ করো।", true);
    return;
  }

  try {
    const approvedSnap = await getDocs(query(
      collection(db, "registrations"),
      where("tournamentId", "==", tournamentId),
      where("status", "==", "approved")
    ));

    if (approvedSnap.empty) {
      showMessage("এই Tournament-এ এখনো Approved Player নেই।", true);
      return;
    }

    // Max tournament slots are 500, within Firestore's 500-write batch limit.
    const batch = writeBatch(db);
    approvedSnap.docs.forEach((registration) => {
      batch.update(registration.ref, {
        roomId,
        roomPassword,
        roomDetailsUpdatedAt: serverTimestamp()
      });
    });
    await batch.commit();

    form.reset();
    showMessage(`${approvedSnap.size} জন Approved Player-কে Room Details পাঠানো হয়েছে।`);
    await loadAdminData();
    await loadPlayerData();
  } catch (error) {
    console.error("Room details update error:", error);
    showMessage(error.message || "Room Details পাঠানো যায়নি।", true);
  }
});

// CREATE TOURNAMENT
document.addEventListener("submit", async (event) => {
  if (event.target.id !== "createTournament") return;
  event.preventDefault();

  if (!(await checkAdmin())) {
    showMessage("শুধু Admin Tournament তৈরি করতে পারবে।", true);
    return;
  }

  const form = event.target;
  const data = Object.fromEntries(new FormData(form));

  const entryFee = Number(data.entryFee);
  const prizePool = Number(data.prizePool);
  const slots = Number(data.slots);

  if (
    !String(data.title || "").trim() ||
    !Number.isFinite(entryFee) || entryFee < 0 ||
    !Number.isFinite(prizePool) || prizePool < 0 ||
    !Number.isInteger(slots) || slots < 1 || slots > 500
  ) {
    showMessage("Tournament-এর তথ্য সঠিকভাবে পূরণ করো।", true);
    return;
  }

  try {
    await addDoc(collection(db, "tournaments"), {
      title: String(data.title).trim(),
      mode: String(data.mode || "Solo"),
      description: String(data.description || "").trim(),
      entryFee,
      prizePool,
      slots,
      joined: 0,
      startsAt: data.startsAt
        ? new Date(data.startsAt).toISOString()
        : "",
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser.uid
    });

    form.reset();
    showMessage("Tournament Publish হয়েছে।");

    await loadTournaments();
    await loadAdminData();
  } catch (error) {
    console.error("Create tournament error:", error);
    showMessage(error.message, true);
  }
});

// ========================================
// ADMIN RESULT PUBLISH + WINNING PRIZE
// ========================================

document.addEventListener("submit", async (event) => {
  if (event.target.id !== "resultForm") return;

  event.preventDefault();

  if (!(await checkAdmin())) {
    showMessage("শুধু Admin Result Publish করতে পারবে।", true);
    return;
  }

  const form = event.target;
  const data = Object.fromEntries(new FormData(form));

  const playerName = String(data.player || "").trim();
  const winnerUserId = String(data.userId || "").trim();
  const tournamentId = String(data.tournamentId || "").trim();

  const placement = Number(data.placement);
  const points = Number(data.points);
  const prizeAmount = Number(data.prizeAmount || 0);

  if (!playerName || !tournamentId) {
    showMessage("Player Name ও Tournament ID দিতে হবে।", true);
    return;
  }

  if (
    !Number.isInteger(placement) ||
    placement < 1 ||
    !Number.isFinite(points) ||
    points < 0 ||
    !Number.isFinite(prizeAmount) ||
    prizeAmount < 0
  ) {
    showMessage("Placement, Points অথবা Prize সঠিক নয়।", true);
    return;
  }

  if (prizeAmount > 0 && !winnerUserId) {
    showMessage("Winning Prize দিতে Player userId আবশ্যক।", true);
    return;
  }

  try {
    let winnerRegistration = null;
    let prizeLedgerRef = null;

    // WINNER REGISTRATION VERIFY
    if (prizeAmount > 0) {

      const registrationSnap = await getDocs(query(
        collection(db, "registrations"),
        where("userId", "==", winnerUserId),
        where("tournamentId", "==", tournamentId)
      ));

      winnerRegistration = registrationSnap.docs.find(
        item => item.data().status === "approved"
      );

      if (!winnerRegistration) {
        throw new Error(
          "এই userId দিয়ে নির্বাচিত Tournament-এ Approved Registration পাওয়া যায়নি।"
        );
      }

      // একই Player + Tournament-এর Prize Ledger ID স্থায়ী থাকবে।
      const safeTournamentId = tournamentId.replaceAll("/", "_");

      const prizeLedgerId =
        `prize_${safeTournamentId}_${winnerUserId}`;

      prizeLedgerRef = doc(
        db,
        "paymentRequests",
        prizeLedgerId
      );

      // DUPLICATE PRIZE CHECK
      const oldPrize = await getDoc(prizeLedgerRef);

      if (oldPrize.exists()) {
        throw new Error(
          "এই Player এই Tournament-এর Winning Prize আগেই পেয়েছে। দ্বিতীয়বার দেওয়া যাবে না।"
        );
      }
    }

    // RESULT DOCUMENT
    const resultRef = doc(collection(db, "results"));

    const batch = writeBatch(db);

    batch.set(resultRef, {
      player: playerName,
      userId: winnerUserId || null,
      placement: placement,
      points: points,
      prizeAmount: prizeAmount,
      prizeStatus: prizeAmount > 0
        ? "credited"
        : "no_prize",
      tournamentId: tournamentId,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser.uid
    });

    // WINNING PRIZE WALLET CREDIT
    if (prizeAmount > 0) {

      batch.set(prizeLedgerRef, {
        userId: winnerUserId,
        type: "tournament_prize",
        amount: prizeAmount,
        status: "approved",
        method: "Tournament Winning Prize",
        reference: `Result ${resultRef.id}`,
        tournamentId: tournamentId,
        resultId: resultRef.id,
        createdAt: serverTimestamp(),
        reviewedAt: serverTimestamp(),
        reviewedBy: auth.currentUser.uid
      });
    }

    // BOTH WRITES COMMIT TOGETHER
    await batch.commit();

    form.reset();

    showMessage(
      prizeAmount > 0
        ? `Result Publish হয়েছে! ৳${money(prizeAmount)} Player Wallet-এ যোগ হয়েছে।`
        : "Result সফলভাবে Publish হয়েছে।"
    );

    await loadLeaderboard();

    if (currentUser) {
      await loadPlayerData();
    }

  } catch (error) {
    console.error("Winning Prize Error:", error);

    showMessage(
      error.message || "Winning Prize Publish করা যায়নি।",
      true
    );
  }
});

// LEADERBOARD
async function loadLeaderboard() {
  try {
    const snapshot = await getDocs(query(
      collection(db, "results"),
      orderBy("points", "desc")
    ));

    if ($("#leaderboardRows")) {
      $("#leaderboardRows").innerHTML = snapshot.docs.map((item, index) => {
        const r = item.data();

        return `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHTML(r.player || "")}</td>
            <td>${Number(r.placement || 0)}</td>
            <td>${Number(r.points || 0)}</td>
            <td>৳${money(r.prizeAmount || 0)}</td>
          </tr>
        `;
      }).join("") || '<tr><td colspan="5">এখনো ফলাফল প্রকাশ হয়নি।</td></tr>';
    }
  } catch (error) {
    console.error("Leaderboard error:", error);

    if ($("#leaderboardRows")) {
      $("#leaderboardRows").innerHTML =
        '<tr><td colspan="5">Leaderboard লোড হয়নি।</td></tr>';
    }
  }
}

// INITIAL PUBLIC DATA
loadTournaments();
loadLeaderboard();
  
