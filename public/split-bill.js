// Split-bill calculations use integer paise so allocations always reconcile exactly.
(() => {
    const toPaise = value => {
        const amount = Number(value);
        if (!Number.isFinite(amount)) throw new Error('Bill amounts must be valid numbers.');
        return Math.round((amount + Number.EPSILON) * 100);
    };
    const fromPaise = amount => amount / 100;
    const roundPercent = (amount, rate) => Math.round(amount * rate / 100);

    function allocate(amount, weights) {
        if (!weights.length) return [];
        const safeWeights = weights.map(weight => Math.max(0, Number(weight) || 0));
        let weightTotal = safeWeights.reduce((sum, weight) => sum + weight, 0);
        if (!weightTotal) {
            safeWeights.fill(1);
            weightTotal = safeWeights.length;
        }
        const exact = safeWeights.map(weight => amount * weight / weightTotal);
        const shares = exact.map(Math.floor);
        let remainder = amount - shares.reduce((sum, share) => sum + share, 0);
        const order = exact.map((value, index) => ({ index, fraction: value - shares[index] }))
            .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
        for (let index = 0; index < remainder; index += 1) shares[order[index].index] += 1;
        return shares;
    }

    function calculateTotals(order, discountRate, gstRate) {
        const lines = Array.isArray(order.items) ? order.items : [];
        if (!lines.length) throw new Error('Add at least one food item before splitting this bill.');
        const itemLines = lines.map(item => {
            const pricePaise = toPaise(item.p);
            const quantity = Number(item.q);
            if (pricePaise < 0 || !Number.isInteger(quantity) || quantity <= 0) {
                throw new Error('Order items must have a valid price and positive whole-number quantity.');
            }
            return {
                id: item.id,
                name: String(item.n || 'Food item'),
                quantity,
                pricePaise
            };
        });
        const subtotalPaise = itemLines.reduce((sum, item) => sum + item.pricePaise * item.quantity, 0);
        const discountPercent = Math.min(100, Math.max(0, Number(discountRate) || 0));
        const gstPercent = Math.max(0, Number(gstRate) || 0);
        const discountPaise = roundPercent(subtotalPaise, discountPercent);
        const serviceChargePaise = Math.max(0, toPaise(order.serviceCharge || 0));
        const taxablePaise = subtotalPaise - discountPaise;
        const taxPaise = roundPercent(taxablePaise, gstPercent);
        return {
            itemLines,
            subtotalPaise,
            discountPaise,
            serviceChargePaise,
            taxablePaise,
            taxPaise,
            totalPaise: taxablePaise + serviceChargePaise + taxPaise,
            discountPercent,
            gstPercent
        };
    }

    function invoice(customerLabel, lines, subtotalPaise, discountPaise, serviceChargePaise, taxPaise, totalPaise) {
        return {
            customerLabel,
            lines,
            subtotalPaise,
            discountPaise,
            serviceChargePaise,
            taxPaise,
            totalPaise,
            status: 'unpaid',
            payments: []
        };
    }

    function totalsFromFinalShares(shares, labels, bill) {
        const discounts = allocate(bill.discountPaise, shares);
        const services = allocate(bill.serviceChargePaise, shares);
        const taxes = allocate(bill.taxPaise, shares);
        return shares.map((share, index) => invoice(
            labels[index],
            [],
            share - taxes[index] - services[index] + discounts[index],
            discounts[index],
            services[index],
            taxes[index],
            share
        ));
    }

    function buildSplit(order, draft, bill) {
        const count = Number(draft.count);
        if (!Number.isInteger(count) || count < 2 || count > 12) {
            return { ok: false, error: 'Choose between 2 and 12 customers.' };
        }
        const labels = Array.from({ length: count }, (_, index) =>
            String(draft.labels?.[index] || `Customer ${index + 1}`).trim().slice(0, 40) || `Customer ${index + 1}`);

        if (draft.method === 'equal') {
            if (bill.totalPaise < count) {
                return { ok: false, error: 'The bill is too small to create a positive share for every customer.' };
            }
            const base = Math.floor(bill.totalPaise / count);
            const shares = Array.from({ length: count }, (_, index) => base + (index < bill.totalPaise % count ? 1 : 0));
            return { ok: true, invoices: totalsFromFinalShares(shares, labels, bill), remainderPaise: 0 };
        }

        if (draft.method === 'items') {
            const allocations = Array.isArray(draft.itemAllocations) ? draft.itemAllocations : [];
            const assignedItems = Array.from({ length: count }, () => []);
            const subtotals = Array(count).fill(0);
            for (let lineIndex = 0; lineIndex < bill.itemLines.length; lineIndex += 1) {
                const line = bill.itemLines[lineIndex];
                const quantities = Array.isArray(allocations[lineIndex]) ? allocations[lineIndex] : [];
                let assigned = 0;
                for (let customerIndex = 0; customerIndex < count; customerIndex += 1) {
                    const quantity = Number(quantities[customerIndex] || 0);
                    if (!Number.isInteger(quantity) || quantity < 0) {
                        return { ok: false, error: `Enter a whole, non-negative quantity for ${line.name}.` };
                    }
                    assigned += quantity;
                    if (assigned > line.quantity) {
                        return { ok: false, error: `Allocated quantity for ${line.name} exceeds the order.` };
                    }
                    if (quantity) {
                        assignedItems[customerIndex].push({
                            name: line.name,
                            quantity,
                            pricePaise: line.pricePaise
                        });
                        subtotals[customerIndex] += line.pricePaise * quantity;
                    }
                }
                if (assigned !== line.quantity) {
                    return { ok: false, error: `Assign all ${line.quantity} ${line.name} before finalizing.` };
                }
            }
            if (subtotals.some(amount => amount <= 0)) {
                return { ok: false, error: 'Assign at least one food item to every customer.' };
            }
            const discounts = allocate(bill.discountPaise, subtotals);
            const taxable = subtotals.map((amount, index) => amount - discounts[index]);
            const services = allocate(bill.serviceChargePaise, subtotals);
            const taxes = allocate(bill.taxPaise, taxable);
            const invoices = subtotals.map((amount, index) => invoice(
                labels[index],
                assignedItems[index],
                amount,
                discounts[index],
                services[index],
                taxes[index],
                amount - discounts[index] + services[index] + taxes[index]
            ));
            return { ok: true, invoices, remainderPaise: 0 };
        }

        if (draft.method === 'custom') {
            const amounts = Array.from({ length: count }, (_, index) => {
                const amount = Number(draft.customAmounts?.[index] || 0);
                return Number.isFinite(amount) ? toPaise(amount) : -1;
            });
            if (amounts.some(amount => amount <= 0)) {
                return { ok: false, error: 'Enter a positive amount for each customer.' };
            }
            const allocatedPaise = amounts.reduce((sum, amount) => sum + amount, 0);
            if (allocatedPaise > bill.totalPaise) {
                return { ok: false, error: `Allocated amount exceeds the bill by ${fromPaise(allocatedPaise - bill.totalPaise).toFixed(2)}.` };
            }
            const remainderPaise = bill.totalPaise - allocatedPaise;
            const shares = [...amounts];
            const shareLabels = [...labels];
            if (remainderPaise > 0) {
                shares.push(remainderPaise);
                shareLabels.push('Unallocated balance');
            }
            const invoices = totalsFromFinalShares(shares, shareLabels, bill);
            if (remainderPaise > 0) invoices[invoices.length - 1].balanceInvoice = true;
            return {
                ok: remainderPaise === 0 || Boolean(draft.recordRemainder),
                error: remainderPaise > 0 && !draft.recordRemainder
                    ? `Record the remaining ${fromPaise(remainderPaise).toFixed(2)} as an unpaid balance before finalizing.`
                    : '',
                invoices,
                remainderPaise
            };
        }

        return { ok: false, error: 'Choose a supported split method.' };
    }

    window.RestaurantSplitBill = {
        toPaise,
        fromPaise,
        calculateTotals,
        buildSplit
    };
})();
