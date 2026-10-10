/** @odoo-module **/
// ProductScreen patch - extend, never rewrite:
//  1. Registers the FacetBar and CategoryTree components.
//  2. Exposes the button that opens the vertical tree.
//  3. Injects facet filtering over the visible product list.

import { patch } from "@web/core/utils/patch";
import { ProductScreen } from "@point_of_sale/app/screens/product_screen/product_screen";
import { DarakjianFacetBar } from "../app/facet_bar/facet_bar";
import { DarakjianCategoryTree } from "../app/category_tree/category_tree";
import { DarakjianBreadcrumb } from "../app/breadcrumb/breadcrumb";
import { DarakjianCaseSerialPicker } from "../app/case_serial_picker/case_serial_picker";

patch(ProductScreen, {
    components: {
        ...ProductScreen.components,
        DarakjianFacetBar,
        DarakjianCategoryTree,
        DarakjianBreadcrumb,
        DarakjianCaseSerialPicker,
    },
});

patch(ProductScreen.prototype, {
    openDarakjianTree() {
        this.pos.darakjianTreeOpen = true;
    },
    // Facet filtering does NOT belong here: the Odoo 19 grid iterates
    // pos.productToDisplayByCateg -> pos.productsToDisplay, both PosStore getters, and
    // never this component's `products` getter. The filter override lives in store.js
    // (PosStore.productsToDisplay), which is where it actually takes effect.

    /** Native: point_of_sale/app/screens/product_screen/product_screen.js. Intercepts
     *  the click on a product card, BEFORE anything is added to the order - only to
     *  reroute it to the Case/Serial picker, and only when that product actually has
     *  more than one unit on hand (darakjianNeedsCasePicker). Anything else falls
     *  through to super() untouched: same behavior as before this module existed. */
    async addProductToOrder(product) {
        if (this.pos.darakjianNeedsCasePicker(product)) {
            this.pos.darakjianCasePickerProduct = product;
            return;
        }
        return super.addProductToOrder(product);
    },

    /** Dedicated full-catalog search, bypassing the per-category load cap entirely
     *  (see darakjianSearchFullCatalog in store.js for why this exists). A native
     *  prompt() instead of an inline text input on purpose: the first version added a
     *  permanent text field to the toolbar and on touchscreens, focusing it pushed the
     *  whole product grid up every keystroke (confirmed in production, 2026-10-09) -
     *  prompt() runs as a browser-native modal outside the page's own layout flow, so
     *  it cannot trigger that reflow. */
    /** Dedicated full-catalog search, bypassing the per-category DK_CATEG_LIMIT cap
     *  entirely (see store.js darakjianLoadCateg for why that cap exists and why it
     *  cannot just be raised). Built on the SAME pieces native "Search more" uses
     *  (point_of_sale/app/screens/product_screen/product_screen.js,
     *  loadProductFromDBDomain + pos.loadNewProducts) rather than a hand-rolled
     *  version - two earlier attempts here got it subtly wrong: counting
     *  result["product.template"] (the payload keys variants under
     *  "product.product", confirmed 2026-10-10 - production kept reporting the
     *  40-row limit itself instead of real matches), and clearing the category via
     *  `pos.selectedCategory = null` instead of the native `setSelectedCategory(0)`,
     *  which is the actual sentinel the grid's filtering logic expects for "no
     *  category restriction". */
    async darakjianSearchCatalog() {
        const query = window.prompt("Buscar en todo el catalogo:");
        if (!query) {
            return;
        }
        try {
            this.pos.setSelectedCategory(0);
            const domain = this.loadProductFromDBDomain(query);
            const result = await this.pos.loadNewProducts(domain, 0, 40);
            const found = (result["product.product"] || []).length;
            window.alert(`Busqueda completa: ${found} producto(s) encontrado(s) para "${query}".`);
        } catch (e) {
            window.alert(`Error al buscar: ${e && e.message ? e.message : e}`);
            console.error("[Darakjian] darakjianSearchCatalog failed:", e);
        }
    },
});
