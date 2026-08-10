/** @odoo-module **/
// Reactive state for Darakjian's custom POS navigation: active facets, the tree overlay,
// and the client-side matching logic. It hooks into the native PosStore through a patch:
// we extend, we do not rewrite.

import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/services/pos_store";

// Categories already loaded, or in flight, in this session - they prevent double loads.
const _dkLoadedCateg = new Set();
const _dkLoadingCateg = new Set();
// Cap on how many non-priority templates are fetched when entering a category. It bounds
// the volume so a huge category cannot hang the UI; everything beyond the cap stays
// reachable through the POS's native search.
const DK_CATEG_LIMIT = 50;

patch(PosStore.prototype, {
    // Odoo 19 pos_hr bug: getCashier() returns undefined before the employee is loaded
    // and then crashes on "_role" of undefined. Optional chaining makes it return false
    // instead of throwing.
    get employeeIsAdmin() {
        const cashier = this.getCashier?.();
        return cashier?._role === "manager";
    },

    setup() {
        super.setup(...arguments);
        // Active facets: { [String(attributeId)]: [valueId, ...] }
        this.darakjianFacets = {};
        // Overlay holding the vertical category tree.
        this.darakjianTreeOpen = false;
    },

    /** Override of the getter that REALLY feeds the Odoo 19 POS grid.
     *  product_screen.xml iterates pos.productToDisplayByCateg, which derives from
     *  pos.productsToDisplay, a PosStore getter - NOT from the ProductScreen component's
     *  own `products` getter. That is why the facet filter has to be applied here to have
     *  any effect at all. */
    get productsToDisplay() {
        const base = super.productsToDisplay;
        if (!this.darakjianActiveFacetCount) {
            return base;
        }
        return base.filter((p) => this.darakjianProductMatches(p));
    },

    /** Toggles one facet value. The object is reassigned rather than mutated, because
     *  mutating in place does not always trigger OWL's reactivity. */
    darakjianToggleFacetValue(attributeId, valueId) {
        const key = String(attributeId);
        const cur = this.darakjianFacets[key] || [];
        const next = cur.includes(valueId)
            ? cur.filter((v) => v !== valueId)
            : [...cur, valueId];
        const all = { ...this.darakjianFacets };
        if (next.length) {
            all[key] = next;
        } else {
            delete all[key];
        }
        this.darakjianFacets = all;
    },

    darakjianIsFacetActive(attributeId, valueId) {
        return (this.darakjianFacets[String(attributeId)] || []).includes(valueId);
    },

    darakjianClearFacets() {
        this.darakjianFacets = {};
    },

    get darakjianActiveFacetCount() {
        return Object.values(this.darakjianFacets).reduce((n, arr) => n + arr.length, 0);
    },

    /** Does the product pass the active facet filter?
     *  AND across different attributes, OR across values of the same attribute. */
    darakjianProductMatches(product) {
        const keys = Object.keys(this.darakjianFacets);
        if (!keys.length) {
            return true;
        }
        const productValues = product.darakjian_facet_values || {};
        return keys.every((attrId) => {
            const wanted = this.darakjianFacets[attrId];
            const have = productValues[attrId] || [];
            return have.some((vid) => wanted.includes(vid));
        });
    },

    // --- On-demand loading of non-priority products, category by category -----------
    // The catalog is NOT preloaded in the background: preloading the ~144 categories,
    // several of them holding thousands of products, saturated the POS sync queue and
    // jammed the session close. Instead each category is loaded ONLY when the cashier
    // selects it (see setSelectedCategory), bounded by DK_CATEG_LIMIT so that a huge
    // category (Watches, at 2.2k) cannot hang the UI.
    //
    // Built entirely on native Odoo 19 APIs: load_product_from_pos returns templates +
    // variants + taxes + attributes in the same shape as the initial payload (image_128
    // as a bool, so images come lazily by URL), and callRelated merges them through the
    // native connectNewData. No custom format and no custom merge, which is what makes it
    // survive upgrades.

    async darakjianLoadCateg(catId) {
        if (_dkLoadedCateg.has(catId) || _dkLoadingCateg.has(catId)) return;
        _dkLoadingCateg.add(catId);
        try {
            // Non-priority templates for the category; the priority ones already came
            // in with the initial load. Anything past the cap stays reachable through
            // the POS's native search.
            const domain = [
                ["pos_categ_ids", "=", catId],
                ["pos_load_priority", "=", false],
            ];
            await this.data.callRelated(
                "product.template",
                "load_product_from_pos",
                [this.config.id, domain, 0, DK_CATEG_LIMIT],
                {},
                true,   // queue=true: sincroniza con el batch nativo evitando race conditions
                true,   // loadMissingRecords (trae relacionados faltantes)
            );
            _dkLoadedCateg.add(catId);
        } finally {
            _dkLoadingCateg.delete(catId);
        }
    },

    async darakjianEnsureCategLoaded(catId) {
        if (!catId || _dkLoadedCateg.has(catId)) return;
        // Deliberately not awaited: the load runs in the background and the UI updates
        // itself on merge, through connectNewData's reactivity. Navigation never blocks.
        this.darakjianLoadCateg(catId).catch((e) =>
            console.warn(`[Darakjian] loading category ${catId} failed:`, e)
        );
    },

    /** On picking a category, load its non-priority products right away if the
     *  background loop has not reached it yet - immediate beats eventual here. */
    setSelectedCategory(categoryId) {
        super.setSelectedCategory(categoryId);
        this.darakjianEnsureCategLoaded(categoryId);
    },
});
